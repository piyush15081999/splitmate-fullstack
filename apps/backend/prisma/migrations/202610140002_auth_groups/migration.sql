-- Preserve Phase 1 identities. A legacy user without a password cannot log in;
-- never fabricate a shared password or allow registration to claim that identity.
ALTER TABLE "User" ADD COLUMN "passwordHash" TEXT;

-- Normalization must not silently merge two pre-existing identities.
DO $$ BEGIN
  IF EXISTS (SELECT lower(trim("email")) FROM "User" GROUP BY lower(trim("email")) HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Resolve duplicate normalized user emails before applying Phase 2';
  END IF;
  IF EXISTS (SELECT 1 FROM "Group" g WHERE NOT EXISTS (SELECT 1 FROM "GroupMember" m WHERE m."groupId" = g.id)) THEN
    RAISE EXCEPTION 'Assign a member to existing empty groups before applying Phase 2';
  END IF;
END $$;
UPDATE "User" SET "email" = lower(trim("email"));

CREATE TABLE "Session" (
  "tokenHash" VARCHAR(64) NOT NULL,
  "csrfToken" VARCHAR(64) NOT NULL,
  "userId" UUID NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Session_pkey" PRIMARY KEY ("tokenHash"),
  CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "Session_userId_idx" ON "Session"("userId");
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

ALTER TABLE "GroupMember" ADD COLUMN "role" VARCHAR(16) NOT NULL DEFAULT 'MEMBER';
WITH ranked AS (
  SELECT "groupId", "userId", row_number() OVER (PARTITION BY "groupId" ORDER BY "joinedAt", "userId") AS position
  FROM "GroupMember"
)
UPDATE "GroupMember" m SET "role" = 'OWNER'
FROM ranked r WHERE m."groupId" = r."groupId" AND m."userId" = r."userId" AND r.position = 1;
ALTER TABLE "GroupMember" ADD CONSTRAINT "GroupMember_role_check" CHECK ("role" IN ('OWNER', 'MEMBER'));
CREATE UNIQUE INDEX "GroupMember_one_owner" ON "GroupMember"("groupId") WHERE "role" = 'OWNER';
