import { createApp } from './app.js';
import { loadConfig } from './config.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export async function startServer(options = {}) {
  const config = options.config || loadConfig();
  const app = await createApp({ ...options, config });
  const server = app.listen(config.port, '0.0.0.0', () => {
    console.log(JSON.stringify({ level: 'info', service: 'records-service', message: 'listening', port: config.port, dbDriver: config.dbDriver }));
  });

  const shutdown = (signal) => {
    console.log(JSON.stringify({ level: 'info', service: 'records-service', message: 'shutting down', signal }));
    const forceTimer = setTimeout(() => process.exit(1), 10_000);
    forceTimer.unref();
    server.close(async () => {
      try { await app.locals.repository.close(); }
      finally { clearTimeout(forceTimer); process.exit(0); }
    });
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
  return { app, server, config };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startServer().catch((error) => {
    console.error(JSON.stringify({ level: 'error', service: 'records-service', message: 'startup failed', code: error.code || 'STARTUP_FAILED' }));
    process.exitCode = 1;
  });
}
