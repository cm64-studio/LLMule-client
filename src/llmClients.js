// src/llmClients.js
const axios = require('axios');
const config = require('./config');

class LLMClient {
  async generateCompletion(model, messages, options = {}) {
    throw new Error('Method not implemented');
  }
}

class OllamaClient extends LLMClient {
  async generateCompletion(model, messages, options = {}) {
    try {
      console.log('Sending request to Ollama:', {
        model,
        messageCount: messages.length,
        options
      });

      const response = await axios.post(`${config.ollama_url}/api/chat`, {
        model,
        messages,
        stream: false,
        ...options
      });

      return {
        choices: [{
          message: {
            role: 'assistant',
            content: response.data.message.content
          }
        }],
        usage: response.data.usage || {}
      };
    } catch (error) {
      console.error('Ollama error:', error.response?.data || error.message);
      throw new Error(`Ollama error: ${error.message}`);
    }
  }
}

class LMStudioClient extends LLMClient {
  async generateCompletion(model, messages, options = {}) {
    try {
      console.log('Sending request to LM Studio:', {
        model,
        messageCount: messages.length,
        options
      });

      const response = await axios.post(`${config.lmstudio_url}/chat/completions`, {
        model,
        messages,
        stream: false,
        ...options
      });

      return response.data;
    } catch (error) {
      console.error('LM Studio error:', error.response?.data || error.message);
      throw new Error(`LM Studio error: ${error.message}`);
    }
  }
}

module.exports = { OllamaClient, LMStudioClient };