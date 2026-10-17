# Reviewed fictional screenshots

Four actual PNG captures from the passing Playwright portfolio journey are published under docs/screenshots. They use the real React/Express UI and an isolated disposable test database, not production records:

| File | View | Dimensions |
| --- | --- | --- |
| dashboard.png | Groups, balances and recent expenses | 1440 x 1000 |
| group-ledger.png | Member balances and repayment suggestions | 1440 x 1000 |
| expense-form.png | Unsaved example expense and participant selection | 1440 x 1000 |
| mobile.png | Responsive group ledger | 390 x 844 |

Alex Morgan, Jamie Chen and Robin Taylor are fictional fixtures with example.test email addresses. Cedar House and Lisbon weekend contain six fictional EUR bills. No production accounts, shared passwords, private financial records or local user ledger were used. Test registrations generate random passwords; none is displayed or published. Native date inputs follow the browser locale.

Visual review confirmed no visible password, token, private URL, email address, personal filesystem path or browser address bar. Each PNG exactly matches its original test capture and has no text/EXIF metadata or trailing data. Local-development/Phase 6 labels reflect the capture environment; these are not represented as screenshots of authenticated production users.

Reproduce with tests/e2e/portfolio.spec.ts in the isolated splitmate_test stack. The full suite writes captures under ignored .local/test-results; the reviewed run's originals are under ignored .local/render-test-results. Copy only the four reviewed files after visual/privacy and metadata checks. Do not publish reports, traces, error contexts, credentials or arbitrary screenshots. Never run this fixture journey against the live demo or a personal database.