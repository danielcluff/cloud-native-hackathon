import { createApp } from './app.ts';
import { loadConfig } from './config.ts';

const config = loadConfig();
const server = createApp(config);

server.listen(config.port, config.host, () => {
  console.log(`cnh-backend listening on http://${config.host}:${config.port}`);
  // Report only presence, never the value.
  console.log(`OpenAI integration: ${config.openaiApiKey ? 'configured' : 'not configured'}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
