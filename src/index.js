const { NetworkClient } = require('./networkClient');

async function main() {
  console.log('Starting P2P LLM Client...');
  const client = new NetworkClient();
  await client.start().catch(console.error);
}

main();