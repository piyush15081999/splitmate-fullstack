# Financial model

## Money and splitting

Amounts are positive integer minor units up to PostgreSQL Int max 2147483647 per expense/repayment. Current currencies EUR, GBP and USD all use two decimal places. No FX is performed. Frontend decimal parsing uses digit strings, not floating-point multiplication. BigInt is used for proportional products and totals; API totals outside JavaScript's safe-integer range are rejected.

Equal split: floor(amount / participant count), then assign remaining minor units by ascending UUID. For 1001 and three ordered UUIDs: 334, 334, 333.

Exact split: accept nonnegative integer shares only when their sum is exactly the amount. For 1001: 501 + 300 + 200 is valid; 500 + 300 + 200 is rejected.

Percentage split: integer basis points must total 10000. Calculate floor(amount * basisPoints / 10000), rank fractional remainders descending, then assign spare minor units. UUID order breaks ties. For 1001 at 50%/30%/20%: 501, 300, 200. All participants and the payer must be current group members; a payer can be excluded from the shares.

## Balances and repayments

net = total paid - total expense share + repayments sent - repayments received.

A positive net is receivable; a negative net is payable. All group nets sum to zero. Paid/share and sent/received are independently aggregated. Reverse records remain in history but their original repayment contributes zero to financial calculations. Reversing never sends/refunds money and never deletes later repayments.

For a 6000 dinner paid by Alex and shared equally with Jamie, Jamie owes Alex 3000. A 1000 repayment from Jamie reduces that obligation to 2000. Reversing the repayment restores 3000.

## Bilateral netting

Expense shares create directed debts toward the expense payer. Reverse-direction amounts between the same two members cancel. For Jamie owing Alex 3000 and Alex owing Jamie 1000, the result is Jamie to Alex 2000. Active repayments are applied as counter-edges. The resulting graph's implied net is independently checked against each ledger member's net.

## Optional simplification

Sort negative and positive net balances by magnitude, then UUID for stable ties. Match the current debtor/creditor for the smaller remaining amount; advance any exhausted participant. Zero-net members are excluded. Example: Alex +6000, Jamie -4000, Robin -2000 produces Jamie to Alex 4000 and Robin to Alex 2000. Every net is conserved, and original expenses/shares are untouched.

This greedy algorithm is deterministic but does not promise the minimum number of transfers. Simplified repayments can leave a balanced cycle in the bilateral graph; zero member nets and zero bilateral edges are different conditions. The UI explains that limitation. No payments are executed.

## Integrity and concurrency

Serializable writes acquire a per-group PostgreSQL row lock, then validate current membership, currency and repayable amounts. Creation keys are scoped to actor plus request fingerprint; matching retries return the record, conflicting key reuse returns 409. Expense edits include expectedVersion to reject lost updates. A unique reversal preserves its reason/actor/time. Expense shares, audit and notifications commit atomically. Deferred PostgreSQL checks reject unbalanced expense shares; audit/reversal triggers protect append-only records. See the migration SQL and integration tests for enforcement, not just the Prisma model.
