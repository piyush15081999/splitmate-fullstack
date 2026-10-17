# Fictional demo screenshots

Pending capture: the screenshot workflow is implemented in tests/e2e/portfolio.spec.ts from the actual React UI and Express/PostgreSQL API. Alex Morgan, Jamie Chen and Robin Taylor are fictional test identities with example.test addresses. Cedar House and Lisbon weekend contain six fictional EUR bills. No normal-application seed, shared account or real user data is used.

The screenshot test registers disposable accounts, creates groups, invites/accepts recipients and posts real expense records through the same protected API. The form screenshot shows an unsaved example. Test data lives only in the isolated temporary test database and is discarded with that test stack.

Run the full test command from README. Captures appear inside .local/test-results under the fictional portfolio test's generated directory. Review dashboard.png, group-ledger.png, expense-form.png and mobile.png visually before copying only those four images into docs/screenshots. Do not copy traces, reports, error-context files, passwords or arbitrary browser screenshots. The screenshot directory is intentionally public; review every replacement for personal data.
