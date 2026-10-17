# Verification history

**Latest result (17 October 2026):** Render preparation passed lint, all typechecks, both builds, 52 unit + 90 integration + 3 Chromium tests (145 total), browser bundle scan, isolated migrations/status and schema drift. See [current evidence](deployment-verification.md). Earlier pending/blocked entries below are historical and superseded by that report. Render has not been deployed.

## Verified in this review

- Inspected existing authentication, group/ledger authorization, Origin/CSRF checks, rate limits, password hashing, sessions, financial calculations and test assertions. Findings and limitations are in [security review](security-review.md) and [test coverage](testing.md).
- Initial full and omit-dev npm audits reported 4 high-severity package entries. With owner approval, pinned Prisma, @prisma/client and @prisma/adapter-pg to 7.10.1 and regenerated the lockfile using ignore-scripts. Related Prisma dependencies, deepmerge-ts 8.0.2 and mysql2 3.24.4 changed; application framework versions did not change.
- Repeated full and omit-dev lockfile audits both exited 0 with 0 known advisories. The host Node 21 was used only for lockfile/registry queries and file tooling; it emitted engine warnings. Application execution requires Node 22 and no runtime test pass is inferred from those queries.
- Repository-safety checks passed over 89 public candidate files before screenshot creation. Ignore probes cover environment files, dependencies, personal data directories, dumps, artifacts, logs and private keys. In the isolated local clone, force-staging a fictional .env.leak-test made the check fail; removing that fixture restored a pass. No matched secret values were printed.
- Both Compose configurations validated from exported public source without a .env file.
- Created a local-only Git source fixture and independent clone under ignored .local, excluding .env, generated Prisma client, node_modules and application data. Updated that clone to the approved lockfile. Creating a clone is not proof that it builds.
- Official CI action commit IDs were read from their public v4 tags and pinned. Repository safety, lint, typechecks, PostgreSQL migrations/integration, builds, schema drift and Chromium steps are configured. No remote GitHub Actions run has occurred.

## Pending / blocked

The clean-clone Docker build and full current-revision tests could not be confirmed. Docker's Linux-engine API returned 500 Internal Server Error even for listing the isolated project's containers. No current-revision test pass, fresh-install reproducibility or new screenshot capture is claimed. The expected added tests must run before counting them as passing.

The historical Phase 6 baseline was 37 unit + 87 integration + 1 Chromium journey = 125 passed tests, three healthy services, six applied migrations, no drift and an exact before/after data fingerprint. Those results precede this revision's presentation changes and Prisma patch; they are not relabelled as current evidence.

Current additions awaiting execution: UTC presentation regressions, Secure-cookie configuration assertion and a fictional portfolio screenshot journey. Curated screenshot files and their visual/privacy review remain pending. The normal application database has not been seeded, reset or migrated during portfolio preparation. Current app health/data preservation has not been re-asserted while Docker is failing.

## Reproduction and next steps

With a responsive Docker engine, run the isolated test command in README from a clean checkout. Preserve its exit code, review every result, then capture/review the four fictional screenshots as described in [screenshots](screenshots.md). Remove only that separate test stack afterward. Do not reset the app database or restart unrelated services to fix tests.

Publication preparation on 17 October 2026 initialized the application folder on main and configured origin as https://github.com/piyush15081999/splitmate-fullstack.git. No public repository creation or push has occurred. The repository safety gate passed for 101 candidate files. A public GitHub API lookup returned 404; private repository existence cannot be determined without authentication. Repository-level GitHub settings and license selection remain owner decisions.

## Publication checks on 17 October 2026

- Repository safety check: passed for 101 candidate files; this remains a heuristic scan.
- Host npm test: executed and failed before tests ran because Vitest is not installed locally.
- Host npm run build: executed and failed before compilation because TypeScript is not installed locally.
- Host Node is 21.6.2; this project requires Node 22. No application test result is inferred from host execution.
- The separate Node 22 Docker verification log still contains only its runtime version; no completed test/build result is available.
- Current screenshots remain pending. The historical 125-test report is not a pass for this commit.
- No PostgreSQL reset, cloud deployment or GitHub push was performed.

## Neon preparation on 17 October 2026

- GitHub Actions reports completed/success for published main commit 11c82557bd14568a48cbefba0a128e57582f20da: https://github.com/piyush15081999/splitmate-fullstack/actions/runs/38986845212. This establishes the workflow result for the published baseline, not the new DIRECT_URL changes.
- Added DIRECT_URL with legacy DIRECT_DATABASE_URL compatibility, conflict rejection and same-target Neon validation. Three regression cases were added; they are not counted as passed until executed.
- Repository checks passed for 103 candidate files. Both .env and .local/neon.env are ignored. Schema, six migrations and local Compose configuration have no diff from the published baseline.
- Local frontend and proxied health requests timed out. Docker status/version probes have not returned usable results. Local service operation is not verified for this review.
- The previous Docker verification exited 125 with an unexpected-EOF infrastructure error. This exit code is not a count of passed tests.
- Private Neon settings are being prepared by the owner. No cloud connectivity result, migration status or migration application is claimed. The root .env was not edited; no cloud write, seed, Render deployment or GitHub push has been performed in this review.
- Current host npm test and npm run build were executed and both exited 1 before executing tests/compilation: local Vitest and TypeScript executables are absent. The isolated cached-image configuration test was started; no result has yet been recorded.
