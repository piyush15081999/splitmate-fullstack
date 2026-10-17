import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'prisma/config';
import { migrationDatabaseUrl } from './src/runtime-config.js';

dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // CLI database operations select the direct URL; generation uses prisma.generate.config.ts.
  datasource: { url: migrationDatabaseUrl(process.env) },
});
