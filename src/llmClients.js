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

      // Format request to match OpenAI API
      const requestBody = {
        model,
        messages,
        temperature: options.temperature || 0.7,
        max_tokens: options.max_tokens || 4096,
        stream: false
      };

      console.log('LM Studio Request:', JSON.stringify(requestBody, null, 2));

      const response = await axios.post(
        `${config.lmstudio_url}/chat/completions`, 
        requestBody
      );

      // Ensure response matches OpenAI format
      const formattedResponse = {
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: model,
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: response.data.choices[0].message.content
          },
          finish_reason: response.data.choices[0].finish_reason || 'stop'
        }],
        usage: response.data.usage || {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0
        }
      };

      console.log('Formatted Response:', JSON.stringify(formattedResponse, null, 2));
      return formattedResponse;

    } catch (error) {
      console.error('LM Studio error:', error.response?.data || error.message);
      throw new Error(`LM Studio error: ${error.message}`);
    }
  }
}

class ExoClient extends LLMClient {
  async generateCompletion(model, messages, options = {}) {
    try {
      console.log('Sending request to EXO:', {
        model,
        messageCount: messages.length,
        options
      });

      const response = await axios.post(
        `${config.exo_url}/v1/chat/completions`,
        {
          model,
          messages,
          temperature: options.temperature || 0.7,
          max_tokens: options.max_tokens || 4096,
          stream: false
        },
        {
          timeout: 60000 // 60 second timeout
        }
      );

      // EXO already returns OpenAI-compatible format
      return {
        choices: response.data.choices,
        usage: response.data.usage || {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0
        }
      };

    } catch (error) {
      console.error('EXO error:', error.response?.data || error.message);
      throw new Error(`EXO error: ${error.message}`);
    }
  }

  async getAvailableModels() {
    try {
      const response = await axios.get(`${config.exo_url}/v1/models`);
      return response.data.data.map(model => ({
        name: model.id,
        type: 'exo'
      }));
    } catch (error) {
      console.error('Failed to fetch EXO models:', error.message);
      return [];
    }
  }
}

module.exports = { OllamaClient, LMStudioClient, ExoClient };