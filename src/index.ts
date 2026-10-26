import http from 'node:http';
import { createApp } from './app.js';
import { loadConfig } from './config/env.js';
import { createPool } from './db/pool.js';
import { initSocketServer } from './realtime/socket.js';

const config = loadConfig();
const pool = createPool(config.databaseUrl, config.dbPoolMax);
const app = createApp({ pool, config });
const server = http.createServer(app);

// Mount Realtime Socket.IO
initSocketServer(server, { pool, config });

server.listen(config.port, () => {
  console.log(`Hush API & Realtime Socket listening on :${config.port} (${config.env})`);
});

function shutdown(signal: string) {
  console.log(`${signal} received, shutting down`);
  server.close(() => {
    void pool.end().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
