// src/networkClient.js
const ora = require('ora');
const WebSocket = require('ws');
const axios = require('axios');
const { prompt, MultiSelect } = require('enquirer');
const chalk = require('chalk');
const config = require('./config');
const ModelDetector = require('./modelDetector');
const { OllamaClient, LMStudioClient, ExoClient } = require('./llmClients');

const spinner = ora();

class NetworkClient {
  constructor() {
    this.ws = null;
    this.modelDetector = new ModelDetector();
    this.llmClients = {
      ollama: new OllamaClient(),
      lmstudio: new LMStudioClient(),
      exo: new ExoClient()
    };
    this.models = [];
    this.isConnected = false;
    this.activeModels = new Set();
    this.maxConcurrentModels = parseInt(process.env.MAX_CONCURRENT_MODELS || '2');
    this.lastPong = Date.now();
    this.heartbeatInterval = null;
    this.shouldReconnect = true; // Add this flag
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 5000;
    this.muleBalance = 0;
    this.lastBalanceCheck = null;
    this.totalRequestsHandled = 0;
    this.totalTokensProcessed = 0;
  }

  setupHeartbeat() {
    // Clear any existing interval
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    // Setup ping/pong monitoring
    this.ws.on('ping', () => {
      try {
        this.ws.pong();
        this.lastPong = Date.now();
      } catch (error) {
        console.error('Error sending pong:', error);
      }
    });

    this.ws.on('pong', () => {
      this.lastPong = Date.now();
    });

    // Monitor connection health
    this.heartbeatInterval = setInterval(() => {
      if (Date.now() - this.lastPong > 45000) { // 45 seconds timeout
        console.log('❌ Connection appears dead - reconnecting...');
        this.reconnect();
      }
    }, 15000); // Check every 15 seconds
  }

  async getUserInfo() {
    try {
      spinner.start('Verifying account...');
      
      const response = await axios.get(`${config.api_url}/auth/me`, {
        headers: { 
          'Authorization': `Bearer ${config.api_key}`,
          'Accept': 'application/json'
        },
        validateStatus: false
      });

      if (response.status !== 200) {
        spinner.fail('Account verification failed');
        console.error(chalk.red(`   Error: ${response.data?.error || 'Unknown error'}`));
        return null;
      }

      spinner.succeed('Account verified');
      return response.data;
    } catch (error) {
      spinner.fail('Account verification failed');
      console.error(chalk.red(`   Error: ${error.message}`));
      return null;
    }
  }

  async selectModelsToShare(availableModels) {
    try {
      console.log(chalk.cyan('\n📦 Available Models:'));
      availableModels.forEach((model, i) => {
        const shortName = model.name.split('/').pop();
        console.log(chalk.gray(`   ${i + 1}. ${shortName}`));
      });

      console.log(chalk.gray('\nAll models are selected by default'));
      console.log(chalk.gray('Use [Space] to toggle, [Enter] to confirm'));

      // Format choices for the MultiSelect prompt
      const choices = availableModels.map(model => ({
        name: model.name,
        message: model.name.split('/').pop(),
        value: model.name,
        enabled: true,
        initial: true
      }));

      const prompt = new MultiSelect({
        name: 'models',
        message: 'Choose models to share:',
        choices,
        initial: choices.map(c => c.value),
        validate: value => value.length > 0 ? true : 'Please select at least one model',
        onCancel: () => {
          process.exit(0); // Ensure clean exit on Ctrl+C
        }
      });

      const selectedModels = await prompt.run();
      return availableModels.filter(model => selectedModels.includes(model.name));
    } catch (error) {
      if (error.message.includes('canceled')) {
        console.log(chalk.yellow('\n👋 Shutting down...'));
        process.exit(0);
      }
      // If other error occurs, share all models by default
      console.log(chalk.yellow('\n⚠️  Selection error - sharing all models'));
      return availableModels;
    }
  }

  async detectAndConnect() {
    try {
      const availableModels = await this.modelDetector.detectAll();
      
      if (availableModels.length > 0) {
        console.log(chalk.green(`\n✨ Found ${availableModels.length} ${availableModels.length === 1 ? 'model' : 'models'}`));
        
        try {
          this.models = await this.selectModelsToShare(availableModels);
        } catch (error) {
          if (error.message.includes('canceled')) {
            console.log(chalk.yellow('\n👋 Shutting down...'));
            process.exit(0);
          }
          throw error;
        }
        
        if (this.models.length === availableModels.length) {
          console.log(chalk.green('\n✓ Sharing all models'));
        } else {
          console.log(chalk.green(`\n✓ Sharing ${this.models.length} of ${availableModels.length} models`));
        }
        
        await this.connect();
        return;
      }

      console.log('\nWaiting for LLM services...');
      console.log('Press Ctrl+C to exit\n');
      
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(resolve, 10000);
        process.once('SIGINT', () => {
          clearTimeout(timeout);
          console.log(chalk.yellow('\n👋 Shutting down...'));
          process.exit(0);
        });
      });
      
      await this.detectAndConnect();
      
    } catch (error) {
      console.error(chalk.red('Connection failed:'), error.message);
      await new Promise(resolve => setTimeout(resolve, 5000));
      await this.detectAndConnect();
    }
  }

  async start() {
    // Ensure we have valid authentication
    await this.ensureAuthentication();

    while (true) {
      try {
        if (!this.isConnected) {
          await this.detectAndConnect();
        }
        await new Promise(resolve => setTimeout(resolve, 5000));
      } catch (error) {
        if (error.message.includes('No LLM services available')) {
          // Already handled in detectAndConnect
          continue;
        }
        console.error(chalk.red('Connection error:'), error.message);
        this.isConnected = false;
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  }

  async ensureAuthentication() {
    if (!config.api_key) {
      console.log('\n🔑 No API key found. Starting registration process...');

      try {
        const { email } = await prompt({
          type: 'input',
          name: 'email',
          message: 'Please enter your email:',
          validate: value => {
            if (!value.includes('@')) return 'Please enter a valid email';
            return true;
          }
        });

        console.log('\n📨 Registering with server...');
        await axios.post(`${config.api_url}/auth/register`, {
          email
        });

        console.log('\n✅ Registration successful!');
        console.log('📧 Please check your email for your API key');
        console.log('\nOnce you receive your API key:');
        console.log('1. Create a .env file in the project root');
        console.log('2. Add your API key: API_KEY=your-key-here');
        console.log('3. Restart the application\n');
        
        process.exit(0);
      } catch (error) {
        console.error('\n❌ Registration failed:', error.response?.data?.error || error.message);
        process.exit(1);
      }
    }
  }

  async reconnect() {
    if (!this.shouldReconnect) {
      console.log('Reconnection cancelled - shutdown in progress');
      return;
    }

    if (this.ws) {
      this.ws.terminate();
    }
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    
    this.reconnectAttempts++;
    if (this.reconnectAttempts > this.maxReconnectAttempts) {
      console.log('Max reconnection attempts reached. Shutting down...');
      this.cleanup();
      process.exit(1);
      return;
    }
    
    console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
    try {
      await new Promise(resolve => setTimeout(resolve, this.reconnectDelay));
      await this.connect();
      this.reconnectAttempts = 0; // Reset on successful connection
    } catch (error) {
      console.error('Reconnection failed:', error);
    }
  }

  async connect() {
    if (!this.shouldReconnect) {
      console.log('Connection cancelled - shutdown in progress');
      return;
    }

    console.log(`\n🔌 Connecting to ${config.server_url}...`);
  
    this.ws = new WebSocket(config.server_url, {
      headers: { 'Authorization': `Bearer ${config.api_key}` }
    });
  
    spinner.start('Connecting to P2P LLM network...');
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout'));
      }, 15000);
  
      this.ws.on('open', async () => {
        clearTimeout(timeout);
        spinner.succeed('Connected to P2P LLM network');
        this.isConnected = true;
        this.reconnectAttempts = 0;
        
        await this.fetchBalance();
        this.setupHeartbeat();
        
        try {
          await this.register();
          resolve();
        } catch (error) {
          reject(error);
        }
      });

      this.ws.on('message', async (data) => {
        try {
          const message = JSON.parse(data.toString());
          await this.handleMessage(message);
        } catch (error) {
          console.error('Error handling websocket message:', error);
        }
      });
  
      this.ws.on('close', async (code, reason) => {
        spinner.fail(`Disconnected from network: ${reason}`);
        this.isConnected = false;
        
        if (code === 4001) {
          console.error('Authentication failed. Please check your API key');
          this.shouldReconnect = false;
          reject(new Error('Authentication failed'));
        } else if (code === 1000 || !this.shouldReconnect) {
          console.log('Clean disconnection - not attempting to reconnect');
        } else {
          await this.reconnect();
        }
      });
  
      this.ws.on('error', async (error) => {
        console.error('🚨 WebSocket error:', error.message);
        this.isConnected = false;
        reject(error);
      });
    });
  }


  async register() {
    try {
      spinner.start('Registering models with network...');
      
      const userInfo = await this.getUserInfo();
      if (!userInfo || !userInfo.userId) {
        spinner.fail('Registration failed');
        throw new Error('Could not verify account');
      }

      const registrationMessage = {
        type: 'register',
        apiKey: config.api_key,
        models: this.models.map(m => m.name),
        userId: userInfo.userId,
        provider: userInfo.provider
      };

      // Show selected models in a friendly way
      console.log(chalk.cyan('\n📦 Sharing Models:'));
      this.models.forEach(model => {
        const shortName = model.name.split('/').pop();
        console.log(chalk.gray(`   • ${shortName}`));
      });

      this.ws.send(JSON.stringify(registrationMessage));
      spinner.succeed('Models registered successfully');
    } catch (error) {
      spinner.fail('Registration failed');
      console.error(chalk.red(`   Error: ${error.message}`));
      this.isConnected = false;
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.close();
      }
    }
  }

  async handleMessage(message) {
    // Remove the debug logs
    switch (message.type) {
      case 'ping':
        this.ws.send(JSON.stringify({ type: 'pong' }));
        break;

      case 'completion_request':
        spinner.start('Processing request...');
        await this.handleCompletionRequest(message);
        break;

      case 'registered':
        console.log(chalk.green('\n✨ Your node is ready!'));
        console.log(chalk.gray('   Waiting for incoming requests...\n'));
        break;
        
      case 'error':
        console.error(chalk.red('\n❌ Network Error:'), message.error);
        break;

      default:
        // Only log unknown messages in development
        if (process.env.NODE_ENV === 'development') {
          console.warn('Unknown message type:', message.type);
        }
    }
  }

  async handleCompletionRequest(message) {
    const modelInfo = this.models.find(m => m.name === message.model);
    if (!modelInfo) {
      spinner.fail(`Model ${message.model} not available`);
      this.sendErrorResponse(message.requestId, `Model ${message.model} not available`);
      return;
    }

    try {
      if (this.activeModels.size >= this.maxConcurrentModels &&
        !this.activeModels.has(message.model)) {
        throw new Error('Maximum concurrent models reached');
      }

      this.activeModels.add(message.model);
      const client = this.llmClients[modelInfo.type];
      
      // Show a shorter model name
      const shortModelName = modelInfo.name.split('/').pop();
      spinner.text = `Processing request with ${shortModelName}...`;

      const response = await client.generateCompletion(
        modelInfo.name,
        message.messages,
        {
          temperature: message.temperature,
          max_tokens: message.max_tokens
        }
      );

      const tokens = response.usage?.total_tokens || 0;
      this.totalTokensProcessed += tokens;
      this.totalRequestsHandled++;

      spinner.succeed(chalk.green('Request completed'));
      
      // Only show non-sensitive metrics
      console.log(chalk.cyan('\n📊 Request Stats:'));
      console.log(chalk.gray(`   Model: ${shortModelName}`));
      console.log(chalk.gray(`   Tokens: ${tokens.toLocaleString()}`));
      console.log(chalk.gray(`   Request #${this.totalRequestsHandled.toLocaleString()}`));

      // Fetch and show new balance
      await this.fetchBalance();

      this.ws.send(JSON.stringify({
        type: 'completion_response',
        requestId: message.requestId,
        response: response
      }));

    } catch (error) {
      spinner.fail(chalk.red('Request failed'));
      console.error(chalk.gray(`   Error: ${error.message}`));
      this.sendErrorResponse(message.requestId, error.message);
    } finally {
      this.activeModels.delete(message.model);
    }
  }


  sendErrorResponse(requestId, errorMessage) {
    this.ws.send(JSON.stringify({
      type: 'completion_response',
      requestId: requestId,
      response: {
        error: {
          message: errorMessage,
          type: "server_error",
          code: "internal_error"
        }
      }
    }));
  }

  async fetchBalance() {
    try {
      const response = await axios.get(`${config.api_url}/v1/balance`, {
        headers: { 'Authorization': `Bearer ${config.api_key}` }
      });
      
      this.muleBalance = response.data.mule_balance;
      this.lastBalanceCheck = response.data.last_updated;
      
      console.log(chalk.cyan('\n💰 Current Balance:'));
      console.log(chalk.white(`   ${this.muleBalance.toFixed(4)} MULE tokens`));
      console.log(chalk.gray(`   Last updated: ${new Date(this.lastBalanceCheck).toLocaleString()}`));
    } catch (error) {
      console.error(chalk.yellow('⚠️  Could not fetch balance'));
    }
  }

  async cleanup() {
    spinner.start('Cleaning up...');
    this.shouldReconnect = false;

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    if (this.ws) {
      try {
        if (this.ws.readyState === WebSocket.OPEN) {
          await new Promise((resolve) => {
            this.ws.send(JSON.stringify({
              type: 'disconnect',
              message: 'Client shutting down gracefully'
            }), resolve);
          });
        }

        this.ws.terminate();
        spinner.succeed('Shutdown complete');
        
        // Show final stats
        console.log(chalk.cyan('\n📈 Session Summary:'));
        console.log(chalk.white(`   Requests Handled: ${this.totalRequestsHandled}`));
        console.log(chalk.white(`   Tokens Processed: ${this.totalTokensProcessed}`));
        console.log(chalk.white(`   Final Balance: ${this.muleBalance.toFixed(4)} MULE`));
      } catch (error) {
        spinner.fail('Error during cleanup');
        console.error(chalk.gray(`   ${error.message}`));
      }
    }

    this.isConnected = false;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}

// Create a single instance that we'll use throughout the application
const networkClient = new NetworkClient();

// Handle process termination
process.on('SIGINT', async () => {
  console.log('\n👋 Gracefully shutting down...');
  try {
    await networkClient.cleanup();
    process.exit(0);
  } catch (error) {
    console.error('Error during shutdown:', error);
    process.exit(1);
  }
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Termination signal received. Cleaning up...');
  try {
    await networkClient.cleanup();
    process.exit(0);
  } catch (error) {
    console.error('Error during termination cleanup:', error);
    process.exit(1);
  }
});

process.on('unhandledRejection', (error) => {
  console.error('❌ Unhandled promise rejection:', error);
});

module.exports = { NetworkClient, networkClient };