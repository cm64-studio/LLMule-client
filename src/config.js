//src/config.js
require('dotenv').config();

const config = {
  server_url: process.env.SERVER_URL || 'ws://localhost:3000/llm-network',
  api_key: process.env.API_KEY,
  ollama_url: process.env.OLLAMA_URL || 'http://localhost:11434',
  lmstudio_url: process.env.LMSTUDIO_URL || 'http://localhost:1234/v1'
};

module.exports = config;