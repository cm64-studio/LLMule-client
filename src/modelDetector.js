// src/modelDetector.js
const axios = require('axios');
const config = require('./config');
const chalk = require('chalk'); // Add this to package.json
const ServiceChecker = require('./serviceChecker');
class ModelDetector {
  constructor() {
    this.serviceStatus = {
      ollama: false,
      lmstudio: false,
      exo: false
    };
  }

  async checkServices() {
    console.log('\n🔍 Checking LLM services...');
    
    this.serviceStatus.ollama = await ServiceChecker.isServiceRunning(config.ollama_url);
    this.serviceStatus.lmstudio = await ServiceChecker.isServiceRunning(config.lmstudio_url);
    
    return this.serviceStatus;
  }

  async detectOllamaModels() {
    if (!this.serviceStatus.ollama) {
      console.log(chalk.yellow('⚠️  Ollama service not detected'));
      console.log(chalk.gray('   → Install Ollama from https://ollama.ai'));
      console.log(chalk.gray('   → Run "ollama serve" to start the service'));
      return [];
    }

    try {
      const response = await axios.get(`${config.ollama_url}/api/tags`);
      if (response.data && Array.isArray(response.data.models)) {
        const models = response.data.models;
        console.log(chalk.green(`✅ Found ${models.length} Ollama models`));
        return models.map(model => ({
          name: model.name,
          type: 'ollama',
          details: model.details
        }));
      }
      console.log(chalk.yellow('⚠️  No Ollama models found'));
      console.log(chalk.gray('   → Run "ollama pull mistral" to download a model'));
      return [];
    } catch (error) {
      console.error(chalk.red('❌ Ollama error:'), error.message);
      return [];
    }
  }

  async detectLMStudioModels() {
    if (!this.serviceStatus.lmstudio) {
      console.log(chalk.yellow('⚠️  LM Studio service not detected'));
      console.log(chalk.gray('   → Download LM Studio from https://lmstudio.ai'));
      console.log(chalk.gray('   → Start LM Studio and enable local server'));
      return [];
    }

    try {
      const response = await axios.get(`${config.lmstudio_url}/models`);
      if (response.data && response.data.data) {
        const models = response.data.data;
        console.log(chalk.green(`✅ Found ${models.length} LM Studio models`));
        return models.map(model => ({
          name: model.id,
          type: 'lmstudio'
        }));
      }
      console.log(chalk.yellow('⚠️  No LM Studio models loaded'));
      console.log(chalk.gray('   → Load a model in LM Studio before connecting'));
      return [];
    } catch (error) {
      console.error(chalk.red('❌ LM Studio error:'), error.message);
      return [];
    }
  }

  async detectEXOModels() {
    if (!this.serviceStatus.exo) {
      console.log(chalk.yellow('⚠️  EXO service not detected'));
      console.log(chalk.gray('   → Install EXO from https://github.com/exo-explore/exo'));
      console.log(chalk.gray('   → Run "exo" to start the service'));
      return [];
    }

    try {
      const response = await axios.get(`${config.exo_url}/v1/models`);
      if (response.data && response.data.data) {
        const models = response.data.data;
        console.log(chalk.green(`✅ Found ${models.length} EXO models`));
        return models.map(model => ({
          name: model.id,
          type: 'exo'
        }));
      }
      console.log(chalk.yellow('⚠️  No EXO models loaded'));
      console.log(chalk.gray('   → Make sure you have downloaded models first'));
      return [];
    } catch (error) {
      console.error(chalk.red('❌ EXO error:'), error.message);
      return [];
    }
  }

  async detectAll() {
    await this.checkServices();
    
    try {
      const [ollamaModels, lmStudioModels, exoModels] = await Promise.all([
        this.detectOllamaModels(),
        this.detectLMStudioModels(),
        this.detectEXOModels()
      ]);

      const allModels = [...ollamaModels, ...lmStudioModels, ...exoModels];

      if (allModels.length === 0) {
        console.log('\n⚠️  No models detected. Available options:');
        console.log('\n1. Ollama');
        console.log('   → https://ollama.ai');
        console.log('   → ollama pull mistral && ollama serve');
        console.log('\n2. LM Studio');
        console.log('   → https://lmstudio.ai');
        console.log('   → Start app and enable local server');
        console.log('\n3. EXO');
        console.log('   → https://github.com/exo-explore/exo');
        console.log('   → Run: exo\n');
      } else {
        console.log('\n📦 Available Models:');
        if (ollamaModels.length) console.log(`   Ollama: ${ollamaModels.length}`);
        if (lmStudioModels.length) console.log(`   LM Studio: ${lmStudioModels.length}`);
        if (exoModels.length) console.log(`   EXO: ${exoModels.length}\n`);
      }

      return allModels;

    } catch (error) {
      console.error(error.message);
      return [];
    }
  }
}

module.exports = ModelDetector;