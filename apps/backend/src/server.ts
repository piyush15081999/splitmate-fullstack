import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { createDatabaseClient } from './database.js';
import { createApp } from './app.js';
import { runtimeConfig } from './runtime-config.js';

// Resolve the root .env independently of the shell's working directory.
dotenv.config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });
const config = runtimeConfig(process.env);
const prisma = createDatabaseClient(config.databaseUrl, config.production);
const app = createApp(async () => { await prisma.$queryRaw`SELECT 1`; }, { prisma, webOrigin: config.webOrigin, secureCookies: config.secureCookies }, {
  production: config.production, trustProxy: config.trustProxy,
  ...(config.production ? { frontendDir: fileURLToPath(new URL('../../frontend/dist/', import.meta.url)) } : {}),
});
const server = app.listen(config.port, config.host, () => {
  console.log(`SplitMate API listening on port ${config.port}`);
});
let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  const deadline = setTimeout(() => process.exit(1), 10_000);
  deadline.unref();
  server.close(() => { void prisma.$disconnect().then(() => process.exit(0)); });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
