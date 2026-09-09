import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createDependencies } from './dependencies.js';
import { logger } from './logger.js';

const config = loadConfig();
const dependencies = await createDependencies(config);
const app = createApp({ config, ...dependencies });
const server = app.listen(config.port, () => {
  logger.info('service_started', { status: `listening:${config.port}` });
});

async function shutdown(signal) {
  logger.info('service_stopping', { status: signal });
  server.close(async () => {
    await dependencies.repository.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
