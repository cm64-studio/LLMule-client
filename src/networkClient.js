// src/networkClient.js
const WebSocket = require('ws');
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
  }

  async connect() {
    if (!config.api_key) {
      console.error('API key required in environment variables');
      process.exit(1);
    }

    console.log('\n🚀 Starting LLM detection...');
    const availableModels = await this.modelDetector.detectAll();
    
    if (availableModels.length === 0) {
      console.error('\n❌ No local LLM models detected!');
      process.exit(1);
    }

    // Filter models based on SHARED_MODELS env var
    const sharedModelNames = process.env.SHARED_MODELS?.split(',') || [];
    this.models = availableModels.filter(model => 
      sharedModelNames.length === 0 || sharedModelNames.includes(model.name)
    );

    if (this.models.length === 0) {
      console.error('No matching models found for sharing');
      process.exit(1);
    }

    console.log(`\n✅ Selected models: ${this.models.map(m => m.name).join(', ')}`);
    this.connectWebSocket();
  }

  connectWebSocket() {
    console.log(`\n🔌 Connecting to ${config.server_url}...`);
    this.ws = new WebSocket(config.server_url);
    
    this.ws.on('open', () => {
      console.log('✅ Connected to P2P LLM network');
      this.register();
    });

    // Rest of the WebSocket handlers remain the same
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
  
    // Verify registration by sending an immediate ping
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
        console.log('Responding to ping...');
        this.ws.send(JSON.stringify({ type: 'pong' }));
        break;

      case 'completion_request':
        try {
          console.log('Received completion request for model:', message.model);
          await this.handleCompletionRequest(message);
        } catch (error) {
          console.error('Error handling completion request:', error);
          this.ws.send(JSON.stringify({
            type: 'completion_response',
            requestId: message.requestId,
            error: error.message
          }));
        }
        break;
    }
  }

  async handleCompletionRequest(message) {
    console.log('\n=== Processing Completion Request ===');
    console.log('Request details:', {
        model: message.model,
        messageCount: message.messages.length,
        requestId: message.requestId,
        temperature: message.temperature || 0.7,  // Default temperature
        max_tokens: message.max_tokens || 4096    // Default max_tokens
    });

    const model = this.models.find(m => m.name === message.model);
    if (!model) {
        throw new Error(`Model ${message.model} not found in available models`);
    }

    const client = this.llmClients[model.type];
    if (!client) {
        throw new Error(`No client available for model type: ${model.type}`);
    }

    try {
        console.log('Generating completion with local LLM...');
        const response = await client.generateCompletion(
            model.name,
            message.messages,
            {
                temperature: message.temperature || 0.7,
                max_tokens: message.max_tokens || 4096,
                stream: false
            }
        );

        console.log('Completion generated successfully');
        
        this.ws.send(JSON.stringify({
            type: 'completion_response',
            requestId: message.requestId,
            response
        }));

    } catch (error) {
        console.error('Error generating completion:', error);
        throw new Error(`Completion generation failed: ${error.message}`);
    }
  }
}

module.exports = { NetworkClient };