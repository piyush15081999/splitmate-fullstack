ALTER TABLE "Expense" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "editedAt" TIMESTAMPTZ(3);
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_version_positive" CHECK ("version" > 0);
