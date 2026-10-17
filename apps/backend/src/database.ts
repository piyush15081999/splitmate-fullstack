import { PrismaClient } from './generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { databaseSettings } from './database-settings.js';

export function createDatabaseClient(connectionString: string, production = false) {
  return new PrismaClient({
    adapter: new PrismaPg(databaseSettings(connectionString, production)),
    transactionOptions: { maxWait: 10_000, timeout: 15_000 },
  });
}
