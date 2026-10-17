import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'prisma/config';
import { migrationDatabaseUrl } from './src/runtime-config.js';

dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // Generation/validation do not connect. Migration commands require a real URL.
  datasource: { url: migrationDatabaseUrl(process.env) },
});
