-- Preserve existing records and leave unknown historical split/creator metadata explicit.
ALTER TABLE "Expense"
  ADD COLUMN "category" VARCHAR(24) NOT NULL DEFAULT 'OTHER',
  ADD COLUMN "splitType" VARCHAR(16) NOT NULL DEFAULT 'LEGACY',
  ADD COLUMN "createdById" UUID,
  ADD COLUMN "idempotencyKey" UUID,
  ADD COLUMN "requestHash" VARCHAR(64),
  ADD CONSTRAINT "Expense_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "Expense_category_check" CHECK ("category" IN ('FOOD','TRANSPORT','HOUSING','UTILITIES','ENTERTAINMENT','OTHER')),
  ADD CONSTRAINT "Expense_splitType_check" CHECK ("splitType" IN ('LEGACY','EQUAL','EXACT','PERCENTAGE')),
  ADD CONSTRAINT "Expense_request_check" CHECK (
    ("createdById" IS NULL AND "idempotencyKey" IS NULL AND "requestHash" IS NULL) OR
    ("createdById" IS NOT NULL AND "idempotencyKey" IS NOT NULL AND "requestHash" IS NOT NULL)
  );
CREATE UNIQUE INDEX "Expense_createdById_idempotencyKey_key" ON "Expense"("createdById", "idempotencyKey");
ALTER TABLE "ExpenseShare" ADD COLUMN "percentageBps" INTEGER,
  ADD CONSTRAINT "ExpenseShare_percentageBps_check" CHECK ("percentageBps" BETWEEN 0 AND 10000);

-- Deferred checks allow the expense and all its shares to be inserted atomically.
-- Existing historical rows are not rewritten; ledger reads detect incomplete history.
CREATE FUNCTION splitmate_check_expense_total(expense_id UUID) RETURNS void LANGUAGE plpgsql AS $$
DECLARE expected INTEGER; actual BIGINT; share_count BIGINT;
BEGIN
  SELECT "amountMinor" INTO expected FROM "Expense" WHERE id = expense_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT COALESCE(sum("amountMinor"), 0), count(*) INTO actual, share_count FROM "ExpenseShare" WHERE "expenseId" = expense_id;
  IF share_count = 0 OR actual <> expected THEN
    RAISE EXCEPTION 'Expense shares must total the expense amount' USING ERRCODE = '23514';
  END IF;
END $$;
CREATE FUNCTION splitmate_expense_total_trigger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM splitmate_check_expense_total(NEW.id);
  RETURN NULL;
END $$;
CREATE FUNCTION splitmate_share_total_trigger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN PERFORM splitmate_check_expense_total(OLD."expenseId"); END IF;
  IF TG_OP <> 'DELETE' THEN PERFORM splitmate_check_expense_total(NEW."expenseId"); END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "Expense_total_check" AFTER INSERT OR UPDATE ON "Expense"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION splitmate_expense_total_trigger();
CREATE CONSTRAINT TRIGGER "ExpenseShare_total_check" AFTER INSERT OR UPDATE OR DELETE ON "ExpenseShare"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION splitmate_share_total_trigger();
