import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const extra = process.env.SPLITMATE_REVIEW_GIT_DIR ? ['--git-dir=' + process.env.SPLITMATE_REVIEW_GIT_DIR, '--work-tree=.'] : [];
function git(args, input) { const r = spawnSync('git', [...extra, ...args], { encoding: 'utf8', input }); if (r.error || r.status > 1) throw new Error('Git inspection failed; run this check inside a Git checkout.'); return r; }
const listed = git(['ls-files', '--cached', '--others', '--exclude-standard', '-z']);
if (listed.status !== 0) throw new Error('Run this check inside a Git checkout.');
const files = [...new Set(listed.stdout.split('\0').filter(Boolean))];
if (!files.length) throw new Error('No repository files found.');
const failures = [];
const forbidden = /(^|\/)(node_modules|dist|coverage|\.local|test-results|playwright-report|blob-report|pgdata|postgres-data|data|\.data|backups|dumps|personal-data|exports|uploads)(\/|$)|(^|\/)\.env(?!\.example$)(\.|$)|\.(pem|key|p12|pfx|dump|backup|sqlite3?|db|log|csv|xlsx|zip|tar|gz|7z)$/i;
const rules = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['AWS access key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{50,})\b/],
  ['npm token', /\bnpm_[A-Za-z0-9]{36}\b/],
  ['personal Windows path', /[A-Z]:\\(?:Users|NCI)\\/i],
];
for (const file of files) {
  if (file === '.npmrc' || forbidden.test(file) || (file.endsWith('.sql') && !/^apps\/backend\/prisma\/migrations\/[^/]+\/migration.sql$/.test(file))) failures.push(file + ': private/generated path');
  if (/\.(png|jpe?g|webp|ico|woff2?)$/i.test(file)) continue;
  const content=readFileSync(file,'utf8');
  for (const [label, pattern] of rules) if (pattern.test(content)) failures.push(file + ': ' + label);
}
const privateProbes = ['.env', 'apps/backend/.env.production', 'node_modules/probe', '.local/personal.json', 'data/members.csv', 'pgdata/PG_VERSION', 'backups/database.sql', 'test-results/probe.png', 'debug.log', 'private.key', 'exports/personal.csv', '.npmrc'];
const publicProbes = ['.env.example', 'README.md', 'package-lock.json', 'docs/screenshots/dashboard.png', 'apps/backend/prisma/migrations/202610140001_initial/migration.sql'];
const ignored = new Set(git(['check-ignore', '--no-index', '--stdin'], [...privateProbes, ...publicProbes].join('\n') + '\n').stdout.trim().split(/\r?\n/));
for (const file of privateProbes) if (!ignored.has(file)) failures.push(file + ': ignore protection missing');
for (const file of publicProbes) if (ignored.has(file)) failures.push(file + ': required public file is ignored');
if (failures.length) { console.error(failures.join('\n')); process.exitCode=1; }
else console.log('Repository checks passed: ' + files.length + ' candidate files; secret/artifact paths excluded. This is a heuristic check, not a full secret or history audit.');
