# Database schema

PostgreSQL is the system of record. Prisma schema: apps/backend/prisma/schema.prisma. Migration SQL additionally defines checks and triggers Prisma cannot express. All existing six migrations are retained; portfolio preparation adds none.

~~~mermaid
erDiagram
  User ||--o{ Session : authenticates
  User ||--o{ GroupMember : joins
  Group ||--o{ GroupMember : contains
  Group ||--o{ Expense : records
  Expense ||--|{ ExpenseShare : allocates
  GroupMember ||--o{ Expense : pays
  GroupMember ||--o{ ExpenseShare : owes
  Group ||--o{ Settlement : records
  Settlement ||--o| SettlementReversal : reverses
  User ||--o{ GroupInvitation : receives
  Group ||--o{ GroupInvitation : invites
  User ||--o{ Notification : receives
  Activity ||--o{ Notification : announces
~~~

| Model | Purpose and constraints |
| --- | --- |
| User | UUID identity, unique normalized email, display name; nullable password hash supports legacy records without enabling account claiming |
| Session | SHA-256 token hash primary key, separate CSRF token, absolute expiry; user FK with cascading session deletion |
| Group | UUID, name and three-letter currency; API supports EUR/GBP/USD |
| GroupMember | Composite group/user primary key; OWNER or MEMBER role; membership is the authorization boundary |
| Expense | Integer amount, payer membership FK, creator, category, split method, date, expected-version concurrency, actor-scoped creation key/request hash |
| ExpenseShare | Composite expense/user primary key; composite FKs enforce group-consistent participant and expense membership; nonnegative integer amount and optional percentage basis points |
| Settlement | Positive integer amount, sender/receiver membership FKs, date, DIRECT/SIMPLIFIED mode, recorder and actor-scoped creation idempotency |
| SettlementReversal | One per repayment; actor/reason/time retained; original repayment is not overwritten |
| Activity | Unique event key, actor/action/time/reference and JSON snapshot; append-only trigger rejects update/delete |
| Notification | Unique recipient/activity pair, read-once timestamp and visibility scoped to current group membership or recipient invitation |
| GroupInvitation | Unique group/recipient, inviter/recipient FKs, PENDING/ACCEPTED/DECLINED state with matching response timestamp |

Composite foreign keys prevent cross-group payer/share/repayment references. Deferred share-sum triggers reject an expense without complete balanced shares at commit. Repayment/reversal update triggers and restrictive FKs retain history; activity has an append-only update/delete trigger. Inspect SQL for exact coverage: a database owner can disable triggers, and this is not tamper-proof accounting infrastructure.

Activity group/actor/reference UUIDs and actor-name snapshots deliberately have no live foreign keys so historical evidence can outlive an empty group. Current membership still controls activity visibility. Audit history begins with Phase 5; older edits are not fabricated. Database snapshots, dumps and real member data must remain outside Git.

## Migration verification

~~~powershell
docker compose exec backend npm exec -w @splitmate/backend -- prisma migrate status
docker compose exec backend npm exec -w @splitmate/backend -- prisma validate
docker compose exec backend npm exec -w @splitmate/backend -- prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code
~~~

Use migrate deploy on an existing installation; never reset it for a clone/setup demonstration. Automated write tests use only the dedicated splitmate_test database.
