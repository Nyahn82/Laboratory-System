import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { logger } from './logger.js';
import { createAuthStore } from './stores/index.js';

const config = loadConfig();
const store = createAuthStore(config);
const app = createApp({ config, store, logger });

const server = app.listen(config.port, () => {
  logger.info('service_started', { status: config.port, dbDriver: config.dbDriver ?? config.storeKind });
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('service_stopping', { status: signal });
  server.close(async () => {
    try {
      await store.close();
      process.exit(0);
    } catch (error) {
      logger.error('service_shutdown_failed', { errorName: error.name, errorCode: error.code });
      process.exit(1);
    }
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (error) => {
  logger.error('unhandled_rejection', { errorName: error?.name, errorCode: error?.code });
});
