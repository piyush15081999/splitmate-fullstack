# Contributing

Use Node 22.13+ on 22.x, npm workspaces and the setup in README. Keep changes incremental, preserve integer-money invariants and add meaningful regressions for ledger/permission changes. Never seed or reset someone else's database.

Run npm run check:repo, lint, typecheck and the isolated Docker test stack before submitting changes. Use fictional example.test identities and keep logs/reports/data under ignored .local. Do not commit .env files, dumps, private keys or session tokens. Match existing green-and-cream styling and accessible native dialogs.

A license has not yet been selected; ask the owner before external reuse. Report security problems privately as described in SECURITY.md. CI is verification only and does not deploy.
