# Development and local operations

## Configuration

Copy .env.example only when .env is absent. Its credentials are explicitly disposable local examples; never reuse them on an internet-facing service. Prisma CLI resolves the root .env through prisma.config.ts. The container overrides DATABASE_URL with db:5432; a host process uses localhost:5433. Changing POSTGRES_PASSWORD in .env does not change an existing database user's password.

WEB_ORIGIN must be an exact origin without a trailing slash. Use localhost consistently, not a mix of localhost and 127.0.0.1. COOKIE_SECURE=false is for local HTTP only. Production-mode startup requires HTTPS and secure cookies; the provided Compose stack is still local-only.

## Existing checkout / upgrade — PowerShell

~~~powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
docker compose up --build --detach --wait --wait-timeout 600
docker compose ps
Invoke-RestMethod 'http://localhost:5173/api/health'
docker compose exec db pg_isready -U splitmate -d splitmate
docker compose exec backend npm exec -w @splitmate/backend -- prisma migrate status
docker compose exec backend npm exec -w @splitmate/backend -- prisma validate
docker compose exec backend npm exec -w @splitmate/backend -- prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code
~~~

No portfolio-preparation migration is required. Six existing migrations are retained. Never run migrate reset or remove the app volume to fix startup. Stop/start only this application with docker compose stop and docker compose start. Do not alter a separate project's services.

## Slow Docker startup

~~~powershell
docker compose ps
docker compose logs --tail 50 backend frontend
Invoke-RestMethod 'http://localhost:5173/api/health'
# After checking logs, wait longer without rebuilding:
docker compose up --no-build --detach --wait --wait-timeout 600
~~~

A wait timeout may precede a later healthy state. The API response checks PostgreSQL but does not prove every feature works. Internal Docker API 500/EOF errors require resolving the Docker engine itself; do not reset the database. Restarting Docker affects other projects, so schedule that action yourself when safe.

## Host tooling

Use Node 22.13+ on the 22.x line and npm 10+. Docker avoids installing Node on Windows. Host commands, if desired:

~~~powershell
npm ci
npm run db:generate
npm run check:repo
npm run lint
npm run typecheck
npm test
npm run build
# Start the normal app database and apply its existing migrations before host development:
docker compose up --detach --wait db
npm run db:deploy
npm run dev
~~~

Never run integration/E2E writes against the app database. Use the separate compose.e2e.yaml stack from README for complete verification.

## Date and split presentation

API calendar dates remain YYYY-MM-DD and timestamps remain ISO 8601. Displayed dates use 16 Oct 2026; audit timestamps use 16 Oct 2026, 14:30 UTC; monthly summaries use Oct 2026. UTC rendering prevents a recorded calendar date shifting to the previous day in another time zone. Native date inputs retain browser-local input formatting. Internal split codes remain EQUAL/EXACT/PERCENTAGE for compatibility; views display Equal split, Exact amounts and Percentage split, including activity snapshots.
