// src/networkClient.js
const WebSocket = require('ws');
const axios = require('axios');
const { prompt } = require('enquirer');
const config = require('./config');
const ModelDetector = require('./modelDetector');
const { OllamaClient, LMStudioClient } = require('./llmClients');

class NetworkClient {
  constructor() {
    this.ws = null;
    this.modelDetector = new ModelDetector();
    this.llmClients = {
      ollama: new OllamaClient(),
      lmstudio: new LMStudioClient()
    };
    this.models = [];
    this.isConnected = false;
    this.activeModels = new Set();
    this.maxConcurrentModels = parseInt(process.env.MAX_CONCURRENT_MODELS || '2');
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
        console.error('Connection error:', error);
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

  async detectAndConnect() {
    console.log('\n🚀 Starting LLM detection...');
    const availableModels = await this.modelDetector.detectAll();
    
    if (availableModels.length === 0) {
      console.error('\n❌ No local LLM models detected!');
      throw new Error('No models detected');
    }

    this.models = availableModels;
    console.log(`\n✅ Detected models: ${this.models.map(m => m.name).join(', ')}`);
    await this.connect();
  }

  async connect() {
    console.log(`\n🔌 Connecting to ${config.server_url}...`);
    
    // Include API key in WebSocket connection
    const wsUrl = new URL(config.server_url);
    this.ws = new WebSocket(config.server_url, {
      headers: {
        'Authorization': `Bearer ${config.api_key}`
      }
    });
    
    this.ws.on('open', () => {
      console.log('✅ Connected to P2P LLM network');
      this.isConnected = true;
      this.register();
    });

    this.ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data);
        await this.handleMessage(message);
      } catch (error) {
        console.error('Error handling message:', error);
      }
    });

    this.ws.on('close', (code, reason) => {
      console.log(`❌ Disconnected from network: ${reason} (${code})`);
      this.isConnected = false;

      // Handle authentication errors
      if (code === 4001) {
        console.error('Authentication failed. Please check your API key');
        process.exit(1);
      }
    });

    this.ws.on('error', (error) => {
      console.error('🚨 WebSocket error:', error.message);
      this.isConnected = false;
    });
  }

  register() {
    const modelNames = this.models.map(m => m.name);
    console.log('\n=== Registering with network ===');
    console.log('Models to register:', modelNames);
    
    const registrationMessage = {
      type: 'register',
      apiKey: config.api_key,
      models: modelNames
    };
  
    console.log('Sending registration message:', registrationMessage);
    this.ws.send(JSON.stringify(registrationMessage));
    console.log('📝 Registration message sent');
  
    setTimeout(() => {
      console.log('Sending post-registration ping...');
      this.ws.send(JSON.stringify({ type: 'ping' }));
    }, 1000);
  }

  async handleMessage(message) {
    console.log('\n=== Received message from server ===');
    console.log('Message type:', message.type);
    
    switch (message.type) {
      case 'ping':
        this.ws.send(JSON.stringify({ type: 'pong' }));
        break;

      case 'completion_request':
        await this.handleCompletionRequest(message);
        break;

      case 'auth_error':
        console.error('❌ Authentication error:', message.error);
        this.cleanup();
        process.exit(1);
        break;
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
    if (this.ws) {
      try {
        // Send a graceful disconnect message if we're still connected
        if (this.isConnected) {
          this.ws.send(JSON.stringify({
            type: 'disconnect',
            message: 'Client shutting down gracefully'
          }));
        }
        
        // Close the WebSocket connection
        this.ws.close();
        console.log('✅ WebSocket connection closed');
        
        // Clear any active models
        this.activeModels.clear();
        
        // Wait a moment for the close message to be sent
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        console.error('Error during cleanup:', error);
      }
    }
  }
}


// Create a single instance that we'll use throughout the application
const networkClient = new NetworkClient();

// Handle process termination
process.on('SIGINT', async () => {
  console.log('\n👋 Gracefully shutting down...');
  try {
    await networkClient.cleanup();
    console.log('✅ Cleanup completed');
  } catch (error) {
    console.error('❌ Error during shutdown:', error);
  } finally {
    process.exit(0);
  }
});

process.on('unhandledRejection', (error) => {
  console.error('❌ Unhandled promise rejection:', error);
});

module.exports = { NetworkClient, networkClient };