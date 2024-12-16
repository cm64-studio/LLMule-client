# LLMule Client

A peer-to-peer client for sharing Large Language Models (LLMs) across the LLMule network. Run your local LLMs and share them with the community.

## Features

- Automatic detection of local LLM models (Ollama & LM Studio)
- Real-time connection to the LLMule network
- Model tier categorization (Tiny, Small, Medium)
- Health monitoring and automatic reconnection
- Secure API key authentication

## Prerequisites

- Node.js v18 or higher
- One of the following LLM backends:
  - [Ollama](https://ollama.ai) (recommended)
  - [LM Studio](https://lmstudio.ai)

## Installation

1. Clone the repository:
```bash
git clone https://github.com/cm64-studio/LLMule-client.git
cd LLMule-client
```

2. Install dependencies:
```bash
npm install
```

3. Create a configuration file:
```bash
cp .env.example .env
```

## Configuration

Edit `.env` file with your settings:

```env
# Required
API_KEY=your_api_key_here

# Optional
SERVER_URL=ws://localhost:3000/llm-network
OLLAMA_URL=http://localhost:11434
LMSTUDIO_URL=http://localhost:1234/v1

# Advanced
LOG_LEVEL=info
MAX_RETRIES=5
```

## Supported Models

### Tier 1 - Tiny (3B)
- TinyLlama
- Minimum Requirements: 4GB RAM

### Tier 2 - Small (7B)
- Mistral 7B
- Minimum Requirements: 8GB RAM

### Tier 3 - Medium (14B)
- Microsoft Phi-4
- Minimum Requirements: 16GB RAM

## Usage

1. Start your LLM backend (Ollama or LM Studio)

2. Run the client:
```bash
npm start
```

3. Follow the interactive setup:
   - Enter your API key if not configured
   - Select models to share
   - Confirm connection to network

## Running as a Service

### Systemd Service (Linux)

1. Create service file:
```bash
sudo nano /etc/systemd/system/llmule-client.service
```

2. Add configuration:
```ini
[Unit]
Description=LLMule Client
After=network.target ollama.service

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/path/to/llmule-client
ExecStart=/usr/bin/npm start
Restart=always
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

3. Enable and start:
```bash
sudo systemctl enable llmule-client
sudo systemctl start llmule-client
```

### Docker Support

Build and run with Docker:

```bash
docker build -t llmule-client .
docker run -d \
  --name llmule-client \
  --restart unless-stopped \
  -v $(pwd)/.env:/app/.env \
  --network host \
  llmule-client
```

## Monitoring

Check client status:
```bash
npm run status
```

View logs:
```bash
# Live logs
npm run logs

# Error logs
npm run logs:error
```

## Troubleshooting

Common issues and solutions:

1. Connection Issues
```bash
# Check network connectivity
curl -v $SERVER_URL

# Verify Ollama is running
curl http://localhost:11434/api/tags
```

2. Model Detection Issues
```bash
# List Ollama models
ollama list

# Check LM Studio API
curl http://localhost:1234/v1/models
```

## Contributing

1. Fork the repository
2. Create feature branch
3. Commit changes
4. Push to branch
5. Create Pull Request

## Security

- API keys are stored securely
- All network traffic is encrypted
- Models are sandboxed
- Resource limits enforced

## Support

- GitHub Issues: [Report Bug](https://github.com/cm64-studio/LLMule-client/issues)
- Email: andres@cm64.studio

## License

MIT License - see [LICENSE](LICENSE) for details