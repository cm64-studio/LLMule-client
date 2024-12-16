// src/modelDetector.js
const axios = require('axios');
const config = require('./config');

class ModelDetector {
  async detectOllamaModels() {
    console.log('Checking for Ollama models...');
    try {
      const response = await axios.get(`${config.ollama_url}/api/tags`);
      if (response.data && response.data.models) {
        const models = response.data.models;
        console.log(`Found ${models.length} Ollama models`);
        return models.map(model => ({
          name: model.name,
          type: 'ollama'
        }));
      }
      return [];
    } catch (error) {
      console.log('⚠️ Ollama not detected (Is it running on port 11434?)');
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

  async detectAll() {
    console.log('\n🔍 Scanning for local LLM models...');
    const [ollamaModels, lmStudioModels] = await Promise.all([
      this.detectOllamaModels(),
      this.detectLMStudioModels()
    ]);

    const allModels = [...ollamaModels, ...lmStudioModels];
    console.log('\n📊 Detection Results:');
    console.log(`- Ollama models: ${ollamaModels.length}`);
    console.log(`- LM Studio models: ${lmStudioModels.length}`);
    console.log(`- Total models: ${allModels.length}`);
    return allModels;
  }
}

module.exports = ModelDetector;