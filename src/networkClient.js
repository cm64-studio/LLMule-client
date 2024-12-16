const WebSocket = require('ws');
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
    this.ws = new WebSocket(config.server_url);
    
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

    this.ws.on('close', () => {
      console.log('❌ Disconnected from network');
      this.isConnected = false;
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
    }
  }

  async handleCompletionRequest(message) {
    console.log('\n=== Processing Completion Request ===');
    console.log('Request for model:', message.model);

    const modelInfo = this.models.find(m => m.name === message.model);
    if (!modelInfo) {
      console.error(`Model ${message.model} not available`);
      return;
    }

    try {
      // Check if we can handle another model
      if (this.activeModels.size >= this.maxConcurrentModels &&
          !this.activeModels.has(message.model)) {
        throw new Error('Maximum concurrent models reached');
      }

      this.activeModels.add(message.model);
      const client = this.llmClients[modelInfo.type];
      
      const response = await client.generateCompletion(
        modelInfo.name,
        message.messages,
        {
          temperature: message.temperature,
          max_tokens: message.max_tokens
        }
      );

      this.ws.send(JSON.stringify({
        type: 'completion_response',
        requestId: message.requestId,
        response
      }));

    } catch (error) {
      console.error(`Error processing request for ${message.model}:`, error);
      this.ws.send(JSON.stringify({
        type: 'completion_response',
        requestId: message.requestId,
        error: error.message
      }));
    } finally {
      this.activeModels.delete(message.model);
    }
  }

  async cleanup() {
    if (this.ws) {
      this.ws.close();
    }
  }
}

// Handle process termination
process.on('SIGINT', async () => {
  console.log('\nGracefully shutting down...');
  const client = new NetworkClient();
  await client.cleanup();
  process.exit(0);
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled promise rejection:', error);
});

module.exports = { NetworkClient };