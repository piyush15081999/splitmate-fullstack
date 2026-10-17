# CI/CD controls and review

Reviewed on 17 October 2026. No workflow deployment hook, Render API key or production database credential is stored in GitHub Actions.

## Verified and owner-confirmed state

| Control | Evidence / status |
| --- | --- |
| CI workflow | .github/workflows/ci.yml runs on push, pull_request and workflow_dispatch |
| Validation job | validate; GitHub Actions app ID 15368, confirmed through the check-runs API |
| Existing main CI | e6968d13ca4ebe9b8f44be5803fa132ce89c5a4a completed successfully |
| Render live Auto-Deploy | Owner changed On Commit to After CI Checks Pass and confirmed saving it during this review |
| Blueprint | autoDeployTrigger: checksPass, aligned with that owner-confirmed setting |
| Main branch protection | After owner approval, the GitHub API verified required validate/app 15368, strict updates, PRs, administrator enforcement, conversation resolution and force-push/deletion blocks |
| Policy record | .github/branch-protection.main.json records the approved, applied REST payload; editing the file alone changes no remote setting |

The Render setting was owner-confirmed, not independently read through Render's authenticated API. Updating a repository Blueprint does not automatically configure a manually created service. The application and database were not modified by the repository review.

## Automatic deployment gate

Render's After CI Checks Pass mode waits for checks on a new linked-branch commit. It does not auto-deploy when checks fail or no checks are detected. It considers success, neutral and skipped conclusions acceptable. This is not a substitute for an unconditional required job. [Render reference](https://render.com/docs/deploys).

The current validate job has no job-level if, path filters or continue-on-error. It executes the repository gate, lockfile audit, lint, typechecks, unit tests, isolated PostgreSQL migrations/integration, production build/bundle scan, drift and both Chromium suites. Steps fail the job if they fail. Only failure-artifact upload is conditional. Superseded runs cancel. Workflow permissions are contents:read, actions are pinned and the CI database is disposable.

There is no deployment job or deploy hook that can independently deploy before validation. Do not configure On Commit. Manual deploys, deploy hooks and administrators changing settings can bypass an automatic-deployment policy; keep those under explicit owner control. No setting makes a repository owner unable to change the policy.

For a documentation-only commit, the proposed message includes [skip render]. This is Render's documented skip phrase and does not skip GitHub Actions. The documentation change therefore need not redeploy the working application after an approved push.

## Enabled main protection

The owner approved the policy, it was applied through PUT /repos/piyush15081999/splitmate-fullstack/branches/main/protection, and its active values were read back successfully. The JSON is an auditable payload, not automatic configuration-as-code.

The enabled policy requires validate from GitHub Actions (app ID 15368), an up-to-date branch, pull-request/conversation resolution and administrator enforcement. It blocks force pushes and deletion. Zero approving reviews avoids requiring a second person for this personal portfolio repository; it is a CI gate, not independent human review. No production deployment check is required before merging, which avoids a circular CI/deployment dependency.

Publish work on a review branch, let validate pass, then merge through a pull request. Direct publication to main can be blocked. Never disable the rule to work around a failed check. GitHub branch protection is supported for public repositories on the Free plan. [GitHub reference](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches).

The repository policy is active. This documentation update is being published through a pull request after owner approval. No production assets or database records were changed by enabling the policy. Future commits/pushes still require the relevant session authorization.