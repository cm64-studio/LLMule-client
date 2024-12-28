// src/config.js

// Load environment variables
require('dotenv').config();

const config = {
  server_url: process.env.SERVER_URL || 'ws://localhost:3000/llm-network',
  api_url: process.env.API_URL || 'http://localhost:3000',
  api_key: process.env.API_KEY,
  ollama_url: process.env.OLLAMA_URL || 'http://localhost:11434',
  lmstudio_url: process.env.LMSTUDIO_URL || 'http://localhost:1234/v1',
  exo_url: process.env.EXO_URL || 'http://localhost:52415',
  
  // Service ports for detection
  service_ports: {
    ollama: 11434,
    lmstudio: 1234,
    exo: 52415
  }
};

// Debug config on load
console.log('Configuration loaded:', {
  server_url: config.server_url,
  api_url: config.api_url,
  api_key_present: !!config.api_key,
  // Don't log the actual API key
});

module.exports = config;