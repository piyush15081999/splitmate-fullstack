import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const root = 'apps/frontend/dist';
if (!existsSync(join(root, 'index.html'))) throw new Error('Build the frontend before checking its public bundle.');
const secrets = ['DATABASE_URL', 'DIRECT_URL', 'DIRECT_DATABASE_URL', 'SESSION_SECRET', 'POSTGRES_PASSWORD'].map(name => ({ name, value: process.env[name] })).filter(item => item.value && item.value.length >= 6);
const failures = [];
function scan(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name); if (entry.isDirectory()) { scan(file); continue; }
    if (!/\.(js|css|html|json|map)$/.test(entry.name)) continue;
    const source = readFileSync(file, 'utf8');
    for (const secret of secrets) if (source.includes(secret.value)) failures.push(file + ': ' + secret.name);
    if (/postgres(?:ql)?:\/\/[^\s"']+:[^\s"']+@/i.test(source)) failures.push(file + ': database credential URI');
  }
}
scan(root);
if (failures.length) { console.error('Public bundle check failed (values redacted):\n' + failures.join('\n')); process.exitCode = 1; }
else console.log('Public frontend bundle contains none of the configured database/session secret values or credential URIs. This does not replace a complete secret audit.');
