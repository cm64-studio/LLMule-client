// src/networkClient.js
const ora = require('ora');
const WebSocket = require('ws');
const axios = require('axios');
const { prompt } = require('enquirer');
const chalk = require('chalk');
const config = require('./config');
const ModelDetector = require('./modelDetector');
const { OllamaClient, LMStudioClient, ExoClient } = require('./llmClients');

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
      console.log('Getting user info with API key:', config.api_key);
      
      const response = await axios.get(`${config.api_url}/auth/me`, {
        headers: { 
          'Authorization': `Bearer ${config.api_key}`,
          'Accept': 'application/json'
        },
        validateStatus: false // To get full response for debugging
      });
  
      console.log('User info response:', {
        status: response.status,
        headers: response.headers,
        data: response.data
      });
  
      if (response.status !== 200) {
        console.error('User info request failed:', {
          status: response.status,
          data: response.data
        });
        return null;
      }
  
      return response.data;
    } catch (error) {
      console.error('Failed to get user info:', {
        message: error.message,
        response: error.response?.data,
        config: {
          url: error.config?.url,
          headers: error.config?.headers
        }
      });
      return null;
    }
  }

  async detectAndConnect() {
    try {
      const availableModels = await this.modelDetector.detectAll();
      this.models = availableModels;
      
      if (availableModels.length > 0) {
        console.log(chalk.green(`Found ${availableModels.length} models to share`));
        await this.connect();
        return;
      }

      console.log('\nWaiting for LLM services...');
      console.log('Press Ctrl+C to exit\n');
      
      // Wait before retry
      await new Promise(r => setTimeout(r, 10000));
      await this.detectAndConnect();
      
    } catch (error) {
      console.error(chalk.red('Connection failed:'), error.message);
      await new Promise(r => setTimeout(r, 5000));
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
        const response = await axios.post(`${config.api_url}/auth/register`, {
          email
        });

        if (response.data.apiKey) {
          config.api_key = response.data.apiKey;
          console.log('\n✅ Registration successful!');
          console.log('📧 Please check your email to verify your account');
          console.log(`\n🔑 Your API key: ${config.api_key}`);
          console.log('\n⚠️  Please save this API key in your .env file as API_KEY=your_key');

          const { confirm } = await prompt({
            type: 'confirm',
            name: 'confirm',
            message: 'Have you verified your email? (Check your inbox)',
          });

          if (!confirm) {
            console.log('\n❌ Please verify your email before continuing');
            process.exit(1);
          }
        }
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
  
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout'));
      }, 15000);
  
      this.ws.on('open', async () => {
        clearTimeout(timeout);
        console.log('✅ Connected to P2P LLM network');
        this.isConnected = true;
        this.reconnectAttempts = 0;
        
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
        console.log(`❌ Disconnected from network: ${reason} (${code})`);
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
      const userInfo = await this.getUserInfo();
      console.log('Got user info for registration:', userInfo);
  
      if (!userInfo || !userInfo.userId) {
        console.error('Invalid user info received:', userInfo);
        throw new Error('Failed to get valid user info for registration');
      }
  
      const registrationMessage = {
        type: 'register',
        apiKey: config.api_key,
        models: this.models.map(m => m.name),
        userId: userInfo.userId, // Include the MongoDB userId
        provider: userInfo.provider // Include provider info if available
      };
  
      console.log('📝 Sending registration message:', {
        userId: userInfo.userId,
        modelCount: registrationMessage.models.length,
        models: registrationMessage.models
      });
  
      this.ws.send(JSON.stringify(registrationMessage));
    } catch (error) {
      console.error('Registration failed:', error.message);
      this.isConnected = false;
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.close();
      }
    }
  }

  async handleMessage(message) {
    console.log('\n=== Received message from server ===');
    console.log('Message type:', message.type);
    console.log('Message details:', {
      requestId: message.requestId,
      model: message.model,
      hasMessages: !!message.messages
    });
  
    switch (message.type) {
      case 'ping':
        this.ws.send(JSON.stringify({ type: 'pong' }));
        break;
  
      case 'completion_request':
        console.log('Processing completion request:', {
          model: message.model,
          messagesCount: message.messages?.length
        });
        await this.handleCompletionRequest(message);
        break;
  
      case 'registered':
        console.log('Successfully registered with network');
        break;
        
      case 'error':
        console.error('Server error:', message.error);
        break;
  
      default:
        console.warn('Unknown message type:', message.type);
        console.log('Full message:', JSON.stringify(message, null, 2));
    }
  }

  async handleCompletionRequest(message) {
    console.log('\n=== Processing Completion Request ===');
    console.log('Request details:', {
      model: message.model,
      messageCount: message.messages?.length,
      temperature: message.temperature,
      max_tokens: message.max_tokens
    });

    const modelInfo = this.models.find(m => m.name === message.model);
    if (!modelInfo) {
      console.error(`Model ${message.model} not available`);
      this.sendErrorResponse(message.requestId, `Model ${message.model} not available`);
      return;
    }

    try {
      // Check concurrent model limit
      if (this.activeModels.size >= this.maxConcurrentModels &&
        !this.activeModels.has(message.model)) {
        throw new Error('Maximum concurrent models reached');
      }

      this.activeModels.add(message.model);
      const client = this.llmClients[modelInfo.type];

      console.log('Sending to LLM client:', {
        type: modelInfo.type,
        model: modelInfo.name
      });

      const response = await client.generateCompletion(
        modelInfo.name,
        message.messages,
        {
          temperature: message.temperature,
          max_tokens: message.max_tokens
        }
      );

      console.log('Got response from LLM:', {
        model: message.model,
        responseLength: response.choices?.[0]?.message?.content?.length
      });

      // Send response back through WebSocket
      this.ws.send(JSON.stringify({
        type: 'completion_response',
        requestId: message.requestId,
        response: response
      }));

    } catch (error) {
      console.error(`Error processing request for ${message.model}:`, error);
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

  async cleanup() {
    console.log('\n🧹 Cleaning up...');
    this.shouldReconnect = false; // Prevent new reconnection attempts

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    if (this.ws) {
      try {
        // Send graceful disconnect message if possible
        if (this.ws.readyState === WebSocket.OPEN) {
          await new Promise((resolve) => {
            this.ws.send(JSON.stringify({
              type: 'disconnect',
              message: 'Client shutting down gracefully'
            }), resolve);
          });
        }

        this.ws.terminate();
        console.log('✅ WebSocket connection closed');
      } catch (error) {
        console.error('Error during cleanup:', error);
      }
    }

    this.isConnected = false;
    // Give time for final messages to be sent
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