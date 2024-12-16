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
    // Interactive setup if needed
    if (!config.api_key) {
      const response = await prompt({
        type: 'input',
        name: 'apiKey',
        message: 'Please enter your API key:',
        validate: value => value.length > 0 ? true : 'API key cannot be empty'
      });
      config.api_key = response.apiKey;
    }

    // Detect available models
    console.log('\n🚀 Starting LLM detection...');
    const availableModels = await this.modelDetector.detectAll();
    
    if (availableModels.length === 0) {
      console.error('\n❌ No local LLM models detected!');
      console.log('\nPlease ensure either Ollama or LM Studio is running:');
      console.log('1. Ollama: http://localhost:11434');
      console.log('2. LM Studio: http://localhost:1234');
      console.log('\nWould you like to:');
      
      const { action } = await prompt({
        type: 'select',
        name: 'action',
        message: 'Choose an action:',
        choices: [
          { name: 'retry', message: 'Retry detection' },
          { name: 'exit', message: 'Exit program' }
        ]
      });

      if (action === 'retry') {
        return this.connect();
      } else {
        process.exit(0);
      }
    }

    // Model selection with simpler logic
    try {
      const choices = availableModels.map(model => ({
        name: model.name,
        message: `${model.name} (${model.type})`,
        hint: model.type === 'ollama' ? '🦙' : '🔧'
      }));

      const { selected } = await prompt({
        type: 'multiselect',
        name: 'selected',
        message: 'Select models to share (space to select, enter to confirm):',
        choices,
        validate: value => value.length > 0 ? true : 'Please select at least one model'
      });

      this.models = selected.map(modelName => 
        availableModels.find(m => m.name === modelName)
      ).filter(Boolean);

      if (this.models.length === 0) {
        console.log('\n⚠️ No models selected. Please try again.');
        return this.connect();
      }

      console.log(`\n✅ Selected models: ${this.models.map(m => m.name).join(', ')}`);
    } catch (error) {
      console.error('Error during model selection:', error);
      return this.connect();
    }

    // Connect to network
    console.log(`\n🔌 Connecting to ${config.server_url}...`);
    this.ws = new WebSocket(config.server_url);
    
    this.ws.on('open', () => {
      console.log('✅ Connected to P2P LLM network');
      this.register();
    });

    this.ws.on('message', (data) => {
      try {
        const message = JSON.parse(data);
        this.handleMessage(message);
      } catch (error) {
        console.error('Error handling message:', error);
      }
    });

    this.ws.on('close', () => {
      console.log('❌ Disconnected from network. Reconnecting in 5 seconds...');
      setTimeout(() => this.connect(), 5000);
    });

    this.ws.on('error', (error) => {
      console.error('🚨 WebSocket error:', error.message);
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