# Neon connection preparation (no deployment)

Prisma, @prisma/client and @prisma/adapter-pg are pinned to 7.10.1. Prisma Client uses the pg adapter and DATABASE_URL. Prisma CLI reads datasource.url from apps/backend/prisma.config.ts. That config chooses DIRECT_URL, or the supported legacy DIRECT_DATABASE_URL, before the local DATABASE_URL fallback. Conflicting aliases are rejected. Do not add a schema datasource directUrl property for Prisma 7.

## Separate local and cloud configuration

Keep the existing root .env and Compose project/volume unchanged. Compose continues to supply its internal db hostname to the backend. Never replace that URL with Neon. Do not export cloud URLs into your normal local-development shell.

In Neon Console select splitmate-production, the intended branch, database and role. Confirm AWS Europe West 2 (London). Copy the connection string with pooling enabled, then disabled. The pooled endpoint contains -pooler; the direct endpoint does not. Both must identify the same endpoint/database/role. A connection hostname cannot prove the Console project name or branch by itself.

Save the two values privately in ignored .local/neon.env, using deploy/neon.env.example as the template. Do not paste them into chat. Retain sslmode=require (or verify-full) and any Console channel_binding parameter. URL-encode special characters in credentials; prefer the Console-generated strings. No Neon CLI or MCP is required.

## Exact PowerShell preparation

Run from the existing project directory:

~~~powershell
New-Item -ItemType Directory -Force .local | Out-Null
# Run this only if .local/neon.env does not already exist.
if (-not (Test-Path -LiteralPath .local/neon.env)) {
    Copy-Item -LiteralPath deploy/neon.env.example -Destination .local/neon.env
}
notepad .local/neon.env
# Verify ignore protection without displaying the file contents.
git check-ignore .local/neon.env .env
node scripts/check-repository.mjs
~~~

Use Node 22 for application commands. Host Node 21 is unsupported. Do not run tests against Neon: the integration suite requires a separate splitmate_test database.

## Approval sequence

1. Confirm the private settings file is ready and confirm the Console project/branch/database. No connection strings belong in chat, Git, screenshots, test artifacts or logs.
2. Inspect URL metadata privately; verify pooled/direct host pairing, London region, database, role, TLS and public schema. Check both connections with read-only SQL and Prisma. Capture only redacted failures and safe results.
3. Inspect cloud migration history and existing public tables before applying anything. An empty database should have six pending migrations. If existing tables/history differ, stop for diagnosis rather than baseline or reset automatically.
4. Present the exact target and pending migrations, then request explicit approval for prisma migrate deploy. Preparing a URL or running migrate status is not approval to apply migrations.
5. Only after approval, use the direct connection for npm run db:deploy. Do not use migrate dev, db push, migrate reset or a seed against cloud production.
6. Recheck migration status, schema drift and Prisma connectivity over the pooled runtime URL. Verify local health independently. Do not copy local users, sessions or expenses into Neon.

The six existing SQL files are unchanged. They create tables, indexes, financial checks and triggers. Migration 2 normalizes existing email values and assigns group owners, with checks for ambiguous legacy records. Consequently even non-drop migrations require review on a nonempty target. A partially failed migration must be diagnosed; never auto-resolve its history.

## Sessions and later Render configuration

Session hashes, CSRF tokens, users and expirations live in PostgreSQL, not a local file or process-only store. No SESSION_SECRET is required by this implementation. A new Neon database starts with no local accounts or sessions; migration does not upload data. Keep database URLs server-side and never use VITE_ for secrets.

When Render deployment is separately approved, set only the pooled DATABASE_URL in private service settings. DIRECT_URL stays in the separate approved migration workflow. Generation has a connection-free config; npm start and start:render do not migrate. Production requires HTTPS WEB_ORIGIN, COOKIE_SECURE=true and TRUST_PROXY=1. This task does not deploy Render.

The Blueprint currently selects Frankfurt; Neon is in London. These are different regions. Region placement and latency can be revisited at Render deployment; they do not justify recreating the existing Neon project.

## Current verification limits

Configuration changes require the unit/integration suites and builds to run before a new pass is claimed. The historical 125-test result does not establish this revision's correctness. Consult docs/verification.md and the actual command results. Read-only cloud connectivity and migration status remain pending until private settings are ready. Cloud migration execution and a GitHub push each require separate owner approval.

The owner approved the six cloud migrations on 17 October 2026. They applied successfully with Prisma 7.10.1; status is current, schema drift is absent, both Prisma connections work and no application records were seeded. See deployment.md for the updated service environment.
