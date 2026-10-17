# Free Render + Neon deployment

Status: the GitHub repository is public. The owner created Neon project splitmate-production in AWS London. Neon connectivity and migrations await private target verification and approval; Render has not been deployed. See [Neon preparation](neon.md). No live application URL has been tested. See [deployment verification](deployment-verification.md) for actual local results and unexecuted cloud checks.

## Architecture and cost boundaries

~~~mermaid
flowchart LR
  Phone[Phone / laptop browser] -->|HTTPS one origin| Render[Render Free Node service]
  Render --> React[Compiled React assets + SPA routes]
  Render --> API[Express API]
  API -->|Verified TLS / pooled URL| Neon[(Separate Neon Free PostgreSQL)]
  Migration[prisma migrate deploy at startup] -->|Direct TLS URL| Neon
  GitHub[GitHub source and CI] -->|Checks pass| Render
~~~

Use one free native Node service, not separate frontend/backend cloud services. The existing Docker Compose stack remains local and independent. Keep the original local project name/volume; do not upload its database or use its .env on Render.

Reviewed provider docs: [Render Free](https://render.com/docs/free), [Neon plans](https://neon.com/docs/introduction/plans), [Render deploys/CI](https://render.com/docs/deploys). Limits can change: confirm them in the dashboard before creating anything. Render Free sleeps after 15 minutes without inbound traffic and has 750 free instance-hours per workspace/month; Neon Free has a compute/storage/network allowance. Free does not mean continuously available. Do not add artificial keep-alive pings, a paid disk, paid compute or a payment method. If signup demands payment details, stop and ask the owner.

Platform health checks use /healthz (no SQL) so they do not themselves wake Neon. /api/health separately checks real DB connectivity. Open browser tabs poll notifications while visible, which can keep the app/database active; close unused tabs and monitor usage. Render can suspend high external-traffic free services, including external database traffic. No uptime or perpetual free-tier guarantee is made.

## Stage A — finish local verification first

~~~powershell
docker compose -f compose.e2e.yaml run --build --rm tests
$checksExitCode = $LASTEXITCODE
docker compose -f compose.e2e.yaml down
if ($checksExitCode -ne 0) { throw "Checks failed: $checksExitCode" }
~~~

This separate temporary PostgreSQL database is not your local app database. The command builds from source and runs lint/types/unit/integration/build/bundle-secret checks, development Chromium journeys and an HTTPS production-browser test. The test-only TLS ingress creates a disposable self-signed certificate inside its temporary directory; no private certificate is committed and Render never uses that script. Host execution of that test requires OpenSSL; the Docker image already includes it.

## Stage B — GitHub, only after owner approval

1. Sign in at https://github.com. Approve publishing before creating the public repository.
2. Create an empty repository named **splitmate-fullstack**. Do not initialize another README/license in the GitHub UI. Choose a license deliberately; one has not been selected here.
3. From the existing SplitMate project directory, review the files and run the local preparation commands:

~~~powershell
git init -b main
# Requires host Node 22.13+; Docker remains the recommended application runtime.
npm run check:repo
git add .
git diff --cached --stat
git diff --cached --name-only
git diff --cached
# After staged-file review:
git commit -m "Prepare SplitMate full-stack deployment"
git remote add origin https://github.com/YOUR_USERNAME/splitmate-fullstack.git
git remote -v
# PUBLIC PUSH: run only after explicit owner approval.
git push -u origin main
~~~

Replace YOUR_USERNAME. Configure your own Git author identity if requested. In VS Code, open only the SplitMate folder, review Source Control changes and use Publish Branch only after the same approval; do not publish the parent workspace or SRE project. Never send tokens/passwords in chat. GitHub Actions should run the validate job; inspect its real result before enabling auto-deploy. No passing CI badge is fabricated.

## Stage C — Neon Free, only after resource-creation approval

1. Sign in at https://console.neon.tech. Select the Free plan. Create a new project such as splitmate-demo in a region close to Render (the prepared Render Blueprint uses Frankfurt).
2. Use a separate, empty database. Do not select import, restore, pg_dump/pg_restore or an existing local ledger. Preserve all six existing migration files unchanged.
3. Click Connect. Copy the pooled URL (hostname contains -pooler) and then turn pooling off to copy the direct URL. Both must refer to the same database/branch and retain sslmode=require.
4. Paste URLs privately into Render's Environment settings at the next stage. Do not paste them into GitHub, README, a VITE_ variable, screenshots or chat.
5. No seed or fictional record is automatically inserted into the cloud. Once the owner approves demo records, use registered fictional accounts through the deployed UI.

The application retains Prisma 7.10.1 and adapter-pg, using standard PostgreSQL/TLS rather than requiring another paid driver/service. Runtime uses DATABASE_URL. Prisma CLI resolves DIRECT_URL in prisma.config.ts; production CLI commands require it explicitly and reject a Neon pooler hostname. See [Neon's Prisma connection guidance](https://neon.com/docs/guides/prisma).

Neon transaction pooling does not retain session SQL settings. For pooled Neon runtime connections, the driver omits the local per-session statement_timeout; Prisma interactive transactions retain their 15-second execution budget and connection acquisition permits 30 seconds for wake-up. A universal SQL execution timeout for pooled standalone reads is not guaranteed. If needed later, configure a dedicated runtime role's server-side timeout separately from the migration role after review. Local/direct connections retain their 10-second statement timeout. These profiles are tested in configuration tests; a real Neon connection still requires live verification.

## Stage D — Render Free, only after resource-creation approval

Sign in at https://dashboard.render.com. Connect GitHub with access limited to this repository. Choose New > Web Service, the splitmate-fullstack repository, and native Node runtime. Importing render.yaml through a Blueprint is an alternative; either path creates resources and requires approval. Do not use both paths to create duplicate services.

| Setting | Value |
| --- | --- |
| Instance | Free; one service, no disks |
| Root directory | Repository root (blank) |
| Region | Frankfurt, ideally matching Neon |
| Node | 22.23.3 (or a reviewed supported 22.x update) |
| Build | npm ci --include=dev --no-audit --no-fund && npm run build:render |
| Start | npm run start:render |
| Health path | /healthz |
| Auto-deploy | After CI Checks Pass |

Build runs Prisma generation and both TypeScript/Vite builds. --include=dev is deliberate: TypeScript/Vite and Prisma CLI are build/start tools. Start runs prisma migrate deploy, then the compiled API; it does not run migrate dev/reset, import data or seed. Render Free does not offer a paid pre-deploy phase, so migration deployment is part of startup and can run again harmlessly after sleep/restart. A migration failure stops startup instead of serving an incompatible app. Future schema changes still require backward-compatible migration design.

Enter this checklist from deploy/render.env.example, privately:

| Variable | Value / requirement |
| --- | --- |
| NODE_ENV | production |
| HOST | 0.0.0.0 |
| COOKIE_SECURE | true |
| TRUST_PROXY | 1, Render's nearest ingress only |
| WEB_ORIGIN | Exact assigned https://...onrender.com origin; no trailing slash |
| DATABASE_URL | Neon pooled TLS URL |
| DIRECT_URL | Neon direct TLS URL for the same database |
| PORT | Supplied by Render; do not hard-code 5173 |
| SESSION_SECRET | Not used: opaque random session tokens are hashed in PostgreSQL, not signed with a shared secret |

If the assigned URL differs from the name you expected, update WEB_ORIGIN before retrying deployment. Database URLs stay server-side. Verified runtime TLS checks certificates; it does not use rejectUnauthorized=false. The public frontend uses relative /api requests, so there is no production localhost API URL or cross-origin cookie dependency.

Render terminates TLS; trust is limited to one ingress hop, not arbitrary forwarded headers. This assumes all public requests arrive through Render's trusted proxy. Keep local TRUST_PROXY=0. In-memory abuse limits reset when Render sleeps/restarts and are not a distributed defense. No MFA/recovery/production-hardening certification is added by this deployment.

## Stage E — live verification and troubleshooting

Only declare deployment successful after testing the actual public URL. Use the [live verification checklist](deployment-verification.md). In Render, inspect Events/deploy logs and runtime logs. Normal logs contain startup status and safe error metadata, not raw credential URLs, passwords or tokens.

- Build fails: inspect Node version, include-dev installation and generated Prisma client; confirm both dist folders exist.
- Homepage/API routing fails: check NODE_ENV=production and compiled frontend output. Missing /api paths must return JSON 404, not index.html.
- Database fails: verify both private URLs, correct same project/branch, TLS mode, direct migration hostname and free quota. Never reset a database as a fix.
- Login/403: use the single HTTPS origin, correct WEB_ORIGIN, COOKIE_SECURE=true and TRUST_PROXY=1. Clear stale cookies after deliberate origin changes; do not disable CSRF.
- Slow first visit: Render and Neon can both wake from idle. The page/API may need a retry; a first timeout is not proof of data loss.
- Failed migrations: read the failing migration/error safely, diagnose against the cloud database and preserve history. Do not use reset, db push or destructive manual SQL as a shortcut.

## Phone and home-screen access

Open the exact same public HTTPS URL on laptop and phone. Log in with the same account or invite a second registered account. Each browser has its own secure cookie; PostgreSQL records are authoritative across devices. Refresh a group to see another device's changes; there is no full offline sync or real-time financial subscription.

On Android Chrome, use the browser menu > Add to Home screen / Create shortcut (wording can vary); see [Google instructions](https://support.google.com/chrome/answer/15085120?co=GENIE.Platform%3DAndroid). On iPhone Safari, use Share > Add to Home Screen; see [Apple instructions](https://support.apple.com/guide/iphone/iphea86e5236/ios). This is a browser shortcut, not a native app or an offline PWA. No personal data should be used for public demos.
