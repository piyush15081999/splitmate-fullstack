# SplitMate local API

Base: http://localhost:3001/api, or same-origin http://localhost:5173/api through Vite.

Mutations require Content-Type: application/json and Origin: http://localhost:5173 (or the exact configured WEB_ORIGIN). Authenticated writes also need X-CSRF-Token from register/login or GET /auth/me. Cookies are HttpOnly; credentials/tokens must never be copied to documentation or committed. All protected endpoints use the session identity, not a supplied actor ID.

## Authentication and groups

| Method/path | Behaviour |
| --- | --- |
| GET /health | 200 database up; 503 unavailable; no credentials returned |
| POST /auth/register | displayName, email, password; 201 user + CSRF token and session cookie |
| POST /auth/login | email, password; 200 rotated session |
| GET /auth/me | current authenticated user + CSRF token; 401 otherwise |
| POST /auth/logout | empty object; 204 and session revocation |
| GET /groups | only current memberships |
| POST /groups | name, currency (EUR/GBP/USD); 201 with owner membership |
| GET /groups/:id | member-only group detail |
| GET /groups/:id/members | member-only member list |
| POST /groups/:id/members | **Retired in Phase 6**; owner receives 410; no membership write |
| POST /groups/:id/leave | empty object; financial history blocks leaving; owner cannot abandon other members |

## Consent-based invitations

| Method/path | Behaviour |
| --- | --- |
| POST /groups/:id/invitations | owner only; registered email; 201 new, 200 same pending invitation |
| GET /invitations | recipient's pending invitations; page/pageSize |
| POST /invitations/:id/respond | decision ACCEPT or DECLINE; recipient only; 200; same response replayed, conflicting response 409 |

A pending invitation grants no financial/member access. Accepting creates membership atomically; declining never creates it. Answered invitations cannot be resent or answered differently; expiry, resend and ownership transfer are not implemented. Existing memberships remain intact.

## Expenses and balances

| Method/path | Behaviour |
| --- | --- |
| POST /groups/:id/expenses | member only; Idempotency-Key UUID; 201 new, 200 replay |
| PATCH /groups/:id/expenses/:expenseId | full replacement + expectedVersion; recorder/owner; 200, stale version 409 |
| GET /groups/:id/ledger | full member ledger: expenses, shares, balances, bilateral and optional simplified suggestions, settlements |
| GET /ledger | personal currency-separated dashboard totals and 10 recent expenses from own groups |
| GET /groups/:id/expenses | member-only paginated expense history |
| GET /groups/:id/analytics | all-date group spending + authenticated user's personal paid/share/net; no query parameters |

Expense body: description, amountMinor (positive integer), currency (must equal group), paidById, participants, date (YYYY-MM-DD), category, splitType. Categories: FOOD, TRANSPORT, HOUSING, UTILITIES, ENTERTAINMENT, OTHER. EQUAL participants contain userId; EXACT adds amountMinor; PERCENTAGE adds percentageBps. Exact amounts total the bill; basis points total 10000. All participants and payer must belong to the group.

Expense history accepts q, from, to, category, paidById, page, pageSize. Date boundaries are inclusive UTC calendar dates; category/payer filters combine with case-insensitive description search. Pagination defaults to 1/10, page is limited to 10000 and pageSize to 50. Search values are parameterized; PostgreSQL LIKE wildcard characters retain their normal semantics. Invalid/repeated/unknown filters return 400. Analytics do not inherit history filters. Monetary totals remain per currency.

## Repayments, activity and notifications

| Method/path | Behaviour |
| --- | --- |
| POST /groups/:id/settlements | Idempotency-Key UUID; fromUserId, toUserId, amountMinor, currency, date, optional mode DIRECT/SIMPLIFIED; 201/200 |
| POST /groups/:id/settlements/:settlementId/reverse | reason; recorder/owner; 200, same reason replayed; conflicting reason 409 |
| GET /groups/:id/activity | member only; page/pageSize; append-only actor/action/timestamp/reference/data |
| GET /notifications | visible recipient updates; page/pageSize, optional unread=true; unreadCount |
| POST /notifications/:id/read | empty object; own visible notification; first-read timestamp preserved |

Repayments only record money transferred elsewhere. They cannot exceed the server's current repayable amount. Reversal preserves the original and removes its balance effect; it does not refund money or undo subsequent repayments. Ledger writes, audit and notifications are transactional. Group notification access is revoked after leaving; an invitation recipient can see their own invitation without becoming a member.

Common errors: 400 invalid input, 401 unauthenticated/expired, 403 CSRF/origin/permission failure, 404 inaccessible/missing group/reference, 409 conflicting request/version/state, 410 retired direct-add endpoint, 413 large body, 415 non-JSON mutation, 429 rate limit, 503 unavailable database/auth hashing capacity. Responses expose safe messages rather than stack traces. Retry-After is 900 seconds for the auth limiter and 60 for the authenticated-write limiter. See [architecture](architecture.md) for limits, concurrency and security tradeoffs.

## Production hosting

Production uses the same /api paths on the single public HTTPS origin. GET /healthz is an additional database-free liveness endpoint (outside /api); GET /api/health retains its database probe. Missing API endpoints stay JSON 404 even when the frontend SPA is enabled. See [deployment](deployment.md).
