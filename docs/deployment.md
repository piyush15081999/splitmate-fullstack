# Render Free: one Node web service

Live demo: https://splitmate-fullstack.onrender.com. The owner reports successful desktop/mobile verification. A read-only review confirmed the homepage and database health. The existing Neon database has six applied migrations; no current application-data count is claimed. Preserve the deployed service/database and do not create duplicates. See [verification](deployment-verification.md).

## Exact dashboard values

The following values document the existing service and can guide a separately approved fresh deployment. Choose native Node, not Docker or Static Site. Do not import the Blueprint to duplicate the live service.

| Dashboard field | Value |
| --- | --- |
| Repository | https://github.com/piyush15081999/splitmate-fullstack |
| Branch | main, with passing CI |
| Name | splitmate-fullstack |
| Runtime / language | Node |
| Region | Frankfurt (frankfurt) |
| Root directory | Leave blank: repository root |
| Build command | npm ci --include=dev --no-audit --no-fund && npm run build:render |
| Start command | npm start |
| Instance type | Free |
| Health check path | /healthz |
| Auto-deploy | After CI Checks Pass (owner-confirmed) |
| Pre-deploy command | Leave blank |
| Persistent disks | None |
| Publish directory / SPA rewrite | Not applicable: Express serves the assets and routes |

Render does not currently list London; Frankfurt is the prepared European region. Neon stays in AWS London. Do not recreate the existing database to make regions match. Cross-region latency remains a live-deployment consideration.

## Private service environment

| Variable | Exact value / source |
| --- | --- |
| NODE_VERSION | 22.23.3 |
| NODE_ENV | production |
| HOST | 0.0.0.0 |
| COOKIE_SECURE | true |
| TRUST_PROXY | 1 |
| WEB_ORIGIN | Exact Render-assigned HTTPS origin, without trailing slash, path or port override |
| DATABASE_URL | Existing pooled Neon connection string from the Console; retain sslmode=require |

Render assigns PORT; do not set 5173 or 3001. The process listens on process.env.PORT. Do not add DIRECT_URL, DIRECT_DATABASE_URL, SESSION_SECRET, a VITE_ database variable, or local POSTGRES_* settings. Use [the safe checklist](../deploy/render.env.example); never upload local .env or neon.env.

The live origin is https://splitmate-fullstack.onrender.com; WEB_ORIGIN must match it exactly. If a future service uses another assigned URL, change WEB_ORIGIN to that URL. Never disable Origin checks to compensate for a mismatch.

## Build, start and migration boundaries

Build includes dev dependencies because TypeScript, Vite and Prisma generation are build tools. npm run build:render runs the connection-free Prisma generation config, compiles Express and React, then scans the browser bundle for configured secret values and PostgreSQL credential URIs. Generated outputs are apps/backend/dist and apps/frontend/dist. No database connection is needed to build.

npm start runs the compiled Express server. start:render remains a compatibility alias for npm start. Neither start command migrates, seeds or imports data. A restart, sleep or redeploy cannot apply a migration through these commands.

DIRECT_URL is **not needed in Render at build or runtime**. It remains necessary for the separate Prisma migration workflow. apps/backend/prisma.config.ts chooses DIRECT_URL (or the legacy DIRECT_DATABASE_URL) for CLI database operations; apps/backend/prisma.generate.config.ts intentionally has no datasource URL or dotenv loading. Already-applied Neon migrations need not run again for this deployment.

For a future schema change, review its SQL/backward compatibility, back up the cloud database appropriately, inspect the direct target and status, obtain migration approval, apply with prisma migrate deploy in the separate migration environment, verify status/drift, then manually deploy compatible application code. Never use migrate dev/reset, db push or startup seeding against production. Render Free needs no paid pre-deploy hook or persistent disk for this workflow. A code rollback does not roll back schema changes.

## Serving and security decisions

~~~mermaid
flowchart LR
  Browser[Phone or laptop] -->|HTTPS, one origin| Render[Render Free / Express]
  Render --> React[Compiled React assets and SPA]
  Render --> API[/api JSON routes]
  API -->|Pooled PostgreSQL, verified TLS| Neon[(Existing Neon London)]
  Operator[Approved migration workflow] -->|Direct TLS, separate credentials| Neon
~~~

Express registers /api and its JSON 404 before static files and the SPA fallback. Missing assets and dotfiles do not become HTML. Extensionless browser GET/HEAD routes receive index.html. HTML is revalidated; hashed assets cache immutably. React keeps the original green-and-cream interface and uses relative /api URLs with same-origin credentials; no Vite server or cross-origin CORS allowlist is needed in production. The API sends no permissive Access-Control-Allow-Origin header.

Render terminates HTTPS. COOKIE_SECURE=true adds Secure to HttpOnly, SameSite=Strict session cookies. TRUST_PROXY=1 trusts the nearest ingress for req.ip; it assumes all public requests come through Render's trusted proxy. Local defaults stay TRUST_PROXY=0 and HTTP cookies. Sessions and their expiry/CSRF tokens are PostgreSQL-backed, so process restarts do not erase them. Login rotates sessions and logout revokes them.

Writes require the exact WEB_ORIGIN and JSON, including login/registration. Authenticated mutations also require a session CSRF token; membership and operation-specific checks protect group data. Passwords use salted scrypt. Production adds CSP, HSTS, frame restrictions and safe error metadata. Remote runtime TLS verifies certificates; the bounded pg pool uses at most five connections per process. Pooled connections do not rely on per-session SQL timeout settings.

/healthz is process liveness and deliberately does not query Neon on every Render health probe. It can be green while DB connectivity fails. Verify /api/health separately for actual PostgreSQL readiness; do not declare the deployment healthy based only on /healthz.

## Free/local constraints and limitations

Render Free can sleep after inactivity and has compute/bandwidth/build allowances. Neon can also scale to zero. Cold-start errors need retry handling, not artificial keep-alive pings. Check both dashboards' current free limits; no paid disk, extra service or keep-alive monitor is part of this setup. Nothing requires a local PC to stay running after a successful cloud deployment.

Rate limits are in memory and reset with a process restart; they are not distributed controls. No MFA/password recovery, real payment processing, backups/restore certification, load-testing guarantee, cross-browser certification or offline synchronization is claimed. Full-ledger analytics may be expensive for large groups. Node dependencies/build tools are not pruned into a minimal runtime image. Database backups, retention, monitoring, least-privilege roles and abuse controls need an operational policy before handling sensitive real-world data.

## Windows verification without cloud writes

From this existing repository, with Docker's Linux engine running:

~~~powershell
docker compose -p splitmate-render-check -f compose.e2e.yaml run --build --rm tests
$renderChecksExit = $LASTEXITCODE
docker compose -p splitmate-render-check -f compose.e2e.yaml down
if ($renderChecksExit -ne 0) { throw "Render preparation checks failed: $renderChecksExit" }
~~~

This separate tmpfs splitmate_test database never mounts the local application volume and receives no Neon credentials. Do not run the suite against Neon. The preparation report describes the executed native build variant that also proves generation/build work with no direct URL and an unreachable fictional pooled URL.

After separately approving service creation, verify the assigned URL (substitute its actual origin):

~~~powershell
$splitmateOrigin = 'https://YOUR-ASSIGNED-SERVICE.onrender.com'
Invoke-RestMethod "$splitmateOrigin/healthz"
Invoke-RestMethod "$splitmateOrigin/api/health"
Invoke-WebRequest -UseBasicParsing "$splitmateOrigin/" | Select-Object StatusCode
~~~

Then use the [live checklist](deployment-verification.md): HTTPS/cookies, register/login/logout, invite/accept, expense/edit, settlement/reversal, refresh/deep links, mobile and actual sleep/restart persistence. Use fictional demo accounts only after separately authorizing demo writes. Creating a new service triggers an initial deployment; it is not part of this documentation review. The existing service should use the CI gate described in [CI/CD controls](ci-cd.md).

## Provider references

[Render web services](https://render.com/docs/web-services), [Node version](https://render.com/docs/node-version), [Blueprint specification](https://render.com/docs/blueprint-spec), [regions](https://render.com/docs/regions), [free limits](https://render.com/docs/free), [health checks](https://render.com/docs/health-checks), [deploy commands](https://render.com/docs/deploys), [Prisma config](https://www.prisma.io/docs/orm/reference/prisma-config-reference). Recheck provider limits before resource creation.