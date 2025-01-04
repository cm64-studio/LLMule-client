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
        options: {
          temperature: options.temperature || 0.7,
          num_predict: options.max_tokens || 4096,
        }
      });

      // Ensure proper usage calculation for Ollama
      const usage = {
        prompt_tokens: this._estimateTokenCount(messages),
        completion_tokens: this._estimateTokenCount([response.data.message]),
        total_tokens: 0 // Will be calculated below
      };

      usage.total_tokens = usage.prompt_tokens + usage.completion_tokens;

      return {
        choices: [{
          message: {
            role: 'assistant',
            content: response.data.message.content
          },
          finish_reason: 'stop'
        }],
        usage
      };
    } catch (error) {
      console.error('Ollama error:', error.response?.data || error.message);
      throw new Error(`Ollama error: ${error.message}`);
    }
  }

  // Helper method to estimate token count
  _estimateTokenCount(messages) {
    let totalChars = 0;
    messages.forEach(msg => {
      if (typeof msg === 'string') {
        totalChars += msg.length;
      } else if (msg.content) {
        totalChars += msg.content.length;
      }
    });
    // Rough estimate: avg 4 chars per token
    return Math.ceil(totalChars / 4);
  }
}

class LMStudioClient extends LLMClient {
  async generateCompletion(model, messages, options = {}) {
    try {
      const requestBody = {
        model,
        messages,
        temperature: options.temperature || 0.7,
        max_tokens: options.max_tokens || 4096,
        stream: false
      };

      const response = await axios.post(
        `${config.lmstudio_url}/chat/completions`, 
        requestBody
      );

      return {
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: model,
        choices: response.data.choices,
        usage: response.data.usage || {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0
        }
      };

    } catch (error) {
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