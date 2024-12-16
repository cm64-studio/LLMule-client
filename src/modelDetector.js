// src/modelDetector.js
const axios = require('axios');
const config = require('./config');

class ModelDetector {
  async detectOllamaModels() {
    console.log('Checking for Ollama models...');
    try {
      const response = await axios.get(`${config.ollama_url}/api/tags`);
      console.log('Raw Ollama response:', JSON.stringify(response.data, null, 2));
      
      if (response.data && Array.isArray(response.data.models)) {
        const models = response.data.models;
        console.log(`Found ${models.length} Ollama models`);
        return models.map(model => ({
          name: model.name,
          type: 'ollama',
          details: model.details
        }));
      }
      return [];
    } catch (error) {
      console.error('Ollama error:', error.response?.data || error.message);
      return [];
    }
  }

  async detectAll() {
    console.log('\n🔍 Scanning for local LLM models...');
    try {
      const ollamaModels = await this.detectOllamaModels();
      const lmStudioModels = await this.detectLMStudioModels();

      const allModels = [...ollamaModels, ...lmStudioModels];
      console.log('\n📊 Detection Results:', {
        ollamaModels: ollamaModels.map(m => m.name),
        lmStudioModels: lmStudioModels.map(m => m.name),
        total: allModels.length
      });
      
      return allModels;
    } catch (error) {
      console.error('Error in detectAll:', error);
      return [];
    }
  }

  async detectLMStudioModels() {
    console.log('Checking for LM Studio models...');
    try {
      const response = await axios.get(`${config.lmstudio_url}/models`);
      if (response.data && response.data.data) {
        const models = response.data.data;
        console.log(`Found ${models.length} LM Studio models`);
        return models.map(model => ({
          name: model.id,
          type: 'lmstudio'
        }));
      }
      return [];
    } catch (error) {
      console.log('⚠️ LM Studio not detected (Is it running on port 1234?)');
      return [];
    }
  }
}

module.exports = ModelDetector;