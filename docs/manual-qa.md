# Phase 6 manual QA checklist

Use only disposable accounts in the isolated test stack for write checks. Do not reset or seed the application database. The automated Chromium journey is in tests/e2e/ledger.spec.ts; these manual checks complement it rather than claim unexecuted coverage.

- [ ] Record Compose status, health, migration status and schema drift before changing the application.
- [ ] Register two accounts in separate browser profiles; verify one account cannot see the other's groups.
- [ ] Log out and log in; check session revocation, wrong-password errors and absence of session tokens in localStorage/document.cookie.
- [ ] Create a group and invite an existing account. Verify the recipient sees an invitation and no group finances before confirming acceptance. Check decline and duplicate invitations.
- [ ] Confirm no immediate-add form exists and legacy POST /members cannot grant membership.
- [ ] Add 10.01 split equally between three members; confirm deterministic 3.34/3.34/3.33 shares and zero-sum net balances.
- [ ] Try exact shares that do not sum and percentages that do not total 100%; confirm validation.
- [ ] Correct a wrong payer, inspect before/after audit and confirm one bill remains. Submit a stale edit from a second tab; expect conflict.
- [ ] Record a partial repayment, refresh and verify persistence. Reverse it with a reason; confirm original record/audit remains and balances return.
- [ ] Compare personal analytics while signed in as different members. Compare spending category/month sums with full expenses and keep currencies separate.
- [ ] Search and combine category, payer and inclusive date filters; paginate, refresh and use browser Back/Forward.
- [ ] Check read/unread notification state after refresh and invitation access boundaries.
- [ ] Use direct URLs/API IDs from another group and account; expect 404/403 without data leakage. Missing/wrong CSRF or foreign Origin must reject writes.
- [ ] Check phone width 390px, desktop width 1440px, keyboard-only dialogs, Escape, focus restoration, visible focus, labels, error announcements and a screen reader.
- [ ] Inspect failure/loading/empty states with the API unavailable; restore services without resetting data.
- [ ] Confirm the original ledger fingerprint is unchanged after the upgrade and document exact executed test commands/results.
- [ ] Before any public deployment, complete the operational/security work listed in architecture.md; local tests alone do not establish production readiness.
