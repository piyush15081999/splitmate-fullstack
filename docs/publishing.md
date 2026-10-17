# Portfolio publication checklist

Recommended repository name: **splitmate-fullstack**. This describes the project and is the requested public repository name; the existing local directory is preserved. Availability has not been checked. Suggested description: "Full-stack expense sharing with exact integer splits, auditable repayments, PostgreSQL and tested authorization."

This preparation does not create a remote repository, publish or push. The working folder initially had no Git repository. Private staging/clone repositories used for reproducibility are confined to ignored .local.

## Review before publishing

- Review README, screenshots, security findings and verification results.
- Choose a license deliberately. None has been granted by this preparation.
- Decide whether to resolve all dependency advisories first; documented local-only exposure is not a clean security audit.
- Enable private vulnerability reporting, Dependabot alerts and secret scanning/push protection where available.
- Review the staged diff and file names. .gitignore does not remove a secret that was already committed. Rotate any leaked credential and remove it from history before publishing.
- After the first actual CI run, inspect its results before displaying a passing badge. Require the validate job for future merges if branch protection is available.

## Local Git preparation — PowerShell

Run inside the SplitMate directory, never the parent workspace or a separate project. These commands are suggestions; the main working folder is not initialized or committed automatically.

~~~powershell
git init -b main
npm run check:repo
git add .
git diff --cached --stat
git diff --cached --name-only
git diff --cached
# After reviewing every staged file:
git commit -m "Prepare SplitMate portfolio application"
~~~

Git may require your own author name/email configuration. The repository check needs Git and Node, or run the project tooling in Docker. A commit is local; it does not publish anything.

## Remote steps — only after explicit approval

Create an empty GitHub repository under your own account; do not initialize its README separately. Replace piyush15081999 below. Do not execute these publishing steps until you have explicitly approved them.

~~~powershell
git remote add origin https://github.com/piyush15081999/splitmate-fullstack.git
git remote -v
# PUBLISHES CODE: approval required before running.
git push -u origin main
~~~

No paid service or deployment is needed. Repository visibility and GitHub CI are separate from hosting a public application.

## Prepared publication

The local main branch and origin are configured. Review git ls-tree -r --name-only HEAD and docs/verification.md before approving publication. GitHub CLI was unavailable. The public GitHub API returned 404 for the requested repository; a private repository may still exist.

If the repository does not exist, sign into https://github.com/new as piyush15081999, choose splitmate-fullstack and Public, and leave README, license and gitignore initialization unchecked. Creating it publicly is a separate approval step. Do not create or push it until publication is approved. GitHub may prompt for browser authentication; never paste access tokens into chat.
