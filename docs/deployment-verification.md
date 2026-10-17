# Deployment verification

Status: implementation/configuration written; current-source isolated verification is running. No live Render URL, Neon database or public GitHub repository has been created or tested by this work.

## Locally observed before production edits

Frontend / and both direct/proxied /api/health returned HTTP 200 with PostgreSQL up. Six migration directories exist. The last completed full/omit-dev lockfile audits reported zero advisories after the approved Prisma 7.10.1 patch. Historical 125 tests remain historical; they are not counted as this revision's result.

## Current-source checks

Pending command output: clean-checkout build, lint, types, unit/integration, compiled asset/bundle checks, development and HTTPS production browser journeys, migration validation and schema drift. Production browser testing uses a disposable local HTTPS ingress and isolated PostgreSQL, not Render or Neon.

## Unexecuted live checklist

- [ ] GitHub validate job passed for the exact deployed commit; staged files/history contain no sensitive data.
- [ ] Render is Free, Neon is Free, no paid disk/service/payment method was added; usage limits reviewed.
- [ ] Assigned public HTTPS homepage and direct SPA route load with correct CSP/HSTS and compiled assets.
- [ ] Missing API/assets return correct errors; database credentials are absent from browser assets/network payloads.
- [ ] Registration/login/logout work on laptop and phone; cookies are Secure, HttpOnly, SameSite=Strict.
- [ ] Session survives page refresh and a real Render sleep/restart until its server-side expiry; logout revokes it.
- [ ] Six migrations applied to the separate cloud database with migrate deploy; no local data imported.
- [ ] Two fictional registered users invite/accept; pending/nonmember access remains denied.
- [ ] Equal/exact/percentage expenses and corrections persist after refresh and across devices; sums reconcile.
- [ ] Partial/full repayment and reversal preserve the audit and expected balances.
- [ ] Notifications/search/analytics behave correctly; personal analytics use the signed-in user.
- [ ] Mobile layout/forms/touch targets remain usable; browser home-screen shortcut opens the same HTTPS URL.
- [ ] Warm-up errors recover without duplicate records; sleeping/restarting preserves Neon data.
- [ ] Render and Neon usage dashboards stay within free limits; no artificial keep-alive monitor is configured.

No checklist item is marked complete merely because local mocks/tests pass. Future runtime DB pooling/TLS, cold starts and public access require verification against the actual services after approval.
