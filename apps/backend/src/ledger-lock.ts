import type { Prisma } from './generated/prisma/client.js';
export async function lockLedger(tx: Prisma.TransactionClient, id: string) {
  await tx.$queryRaw`SELECT "id" FROM "Group" WHERE "id" = ${id}::uuid FOR UPDATE`;
}
