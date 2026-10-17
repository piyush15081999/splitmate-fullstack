ALTER TABLE "Settlement"
 ADD COLUMN "mode" VARCHAR(16) NOT NULL DEFAULT 'DIRECT',
 ADD COLUMN "createdById" UUID,
 ADD COLUMN "idempotencyKey" UUID,
 ADD COLUMN "requestHash" VARCHAR(64),
 ADD CONSTRAINT "Settlement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 ADD CONSTRAINT "Settlement_mode_check" CHECK ("mode" IN ('DIRECT', 'SIMPLIFIED')),
 ADD CONSTRAINT "Settlement_request_check" CHECK (("createdById" IS NULL AND "idempotencyKey" IS NULL AND "requestHash" IS NULL) OR ("createdById" IS NOT NULL AND "idempotencyKey" IS NOT NULL AND "requestHash" IS NOT NULL));
CREATE UNIQUE INDEX "Settlement_createdById_idempotencyKey_key" ON "Settlement"("createdById", "idempotencyKey");
CREATE TABLE "SettlementReversal" (
 "id" UUID NOT NULL PRIMARY KEY,
 "settlementId" UUID NOT NULL,
 "createdById" UUID NOT NULL,
 "reason" VARCHAR(300) NOT NULL CHECK (length(trim("reason")) > 0),
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "SettlementReversal_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "Settlement"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "SettlementReversal_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SettlementReversal_settlementId_key" ON "SettlementReversal"("settlementId");
CREATE INDEX "SettlementReversal_createdById_idx" ON "SettlementReversal"("createdById");
-- Application APIs never update/delete repayment history; protect immutable audit fields in SQL too.
CREATE FUNCTION splitmate_immutable_repayment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Repayment history is immutable; record a reversal instead' USING ERRCODE = '23514'; END;
$$;
CREATE TRIGGER "Settlement_immutable" BEFORE UPDATE ON "Settlement" FOR EACH ROW EXECUTE FUNCTION splitmate_immutable_repayment();
CREATE TRIGGER "SettlementReversal_immutable" BEFORE UPDATE ON "SettlementReversal" FOR EACH ROW EXECUTE FUNCTION splitmate_immutable_repayment();
