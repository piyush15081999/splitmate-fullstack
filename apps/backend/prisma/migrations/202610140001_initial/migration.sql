CREATE TABLE "User" (
  "id" UUID NOT NULL, "email" VARCHAR(254) NOT NULL, "displayName" VARCHAR(100) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE TABLE "Group" (
  "id" UUID NOT NULL, "name" VARCHAR(100) NOT NULL, "currency" VARCHAR(3) NOT NULL DEFAULT 'EUR',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Group_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Group_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$')
);
CREATE TABLE "GroupMember" (
  "groupId" UUID NOT NULL, "userId" UUID NOT NULL,
  "joinedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GroupMember_pkey" PRIMARY KEY ("groupId", "userId"),
  CONSTRAINT "GroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "GroupMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "GroupMember_userId_idx" ON "GroupMember"("userId");
CREATE TABLE "Expense" (
  "id" UUID NOT NULL, "groupId" UUID NOT NULL, "paidById" UUID NOT NULL,
  "description" VARCHAR(200) NOT NULL, "amountMinor" INTEGER NOT NULL,
  "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Expense_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Expense_amountMinor_check" CHECK ("amountMinor" > 0),
  CONSTRAINT "Expense_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Expense_groupId_paidById_fkey" FOREIGN KEY ("groupId", "paidById") REFERENCES "GroupMember"("groupId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Expense_id_groupId_key" ON "Expense"("id", "groupId");
CREATE INDEX "Expense_groupId_occurredAt_idx" ON "Expense"("groupId", "occurredAt");
CREATE INDEX "Expense_groupId_paidById_idx" ON "Expense"("groupId", "paidById");
CREATE TABLE "ExpenseShare" (
  "expenseId" UUID NOT NULL, "groupId" UUID NOT NULL, "userId" UUID NOT NULL, "amountMinor" INTEGER NOT NULL,
  CONSTRAINT "ExpenseShare_pkey" PRIMARY KEY ("expenseId", "userId"),
  CONSTRAINT "ExpenseShare_amountMinor_check" CHECK ("amountMinor" >= 0),
  CONSTRAINT "ExpenseShare_expenseId_groupId_fkey" FOREIGN KEY ("expenseId", "groupId") REFERENCES "Expense"("id", "groupId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ExpenseShare_groupId_userId_fkey" FOREIGN KEY ("groupId", "userId") REFERENCES "GroupMember"("groupId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "ExpenseShare_groupId_userId_idx" ON "ExpenseShare"("groupId", "userId");
CREATE INDEX "ExpenseShare_expenseId_groupId_idx" ON "ExpenseShare"("expenseId", "groupId");
CREATE TABLE "Settlement" (
  "id" UUID NOT NULL, "groupId" UUID NOT NULL, "fromUserId" UUID NOT NULL, "toUserId" UUID NOT NULL,
  "amountMinor" INTEGER NOT NULL, "settledAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Settlement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Settlement_amountMinor_check" CHECK ("amountMinor" > 0),
  CONSTRAINT "Settlement_participants_check" CHECK ("fromUserId" <> "toUserId"),
  CONSTRAINT "Settlement_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Settlement_groupId_fromUserId_fkey" FOREIGN KEY ("groupId", "fromUserId") REFERENCES "GroupMember"("groupId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Settlement_groupId_toUserId_fkey" FOREIGN KEY ("groupId", "toUserId") REFERENCES "GroupMember"("groupId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "Settlement_groupId_settledAt_idx" ON "Settlement"("groupId", "settledAt");
CREATE INDEX "Settlement_groupId_fromUserId_idx" ON "Settlement"("groupId", "fromUserId");
CREATE INDEX "Settlement_groupId_toUserId_idx" ON "Settlement"("groupId", "toUserId");
