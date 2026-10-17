// Test-only TLS ingress; no certificate or key is committed or used in deployment.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:https';
import { request } from 'node:http';
const directory = mkdtempSync(join(tmpdir(), 'splitmate-https-test-'));
const cert = join(directory, 'cert.pem'), key = join(directory, 'key.pem');
const generated = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1', '-keyout', key, '-out', cert], { stdio: 'ignore' });
if (generated.status !== 0) { rmSync(directory, { recursive: true, force: true }); throw new Error('HTTPS smoke tests require OpenSSL; use the Docker verification stack.'); }
const proxy = createServer({ cert: readFileSync(cert), key: readFileSync(key) }, (incoming, outgoing) => {
  const upstream = request({ hostname: '127.0.0.1', port: 3103, path: incoming.url, method: incoming.method, headers: { ...incoming.headers, 'x-forwarded-proto': 'https', 'x-forwarded-for': incoming.socket.remoteAddress ?? '127.0.0.1' } }, response => { outgoing.writeHead(response.statusCode ?? 502, response.headers); response.pipe(outgoing); });
  upstream.setTimeout(30_000, () => upstream.destroy());
  upstream.on('error', () => { if (!outgoing.headersSent) outgoing.writeHead(502, { 'Content-Type': 'application/json' }); outgoing.end('{"error":"Test upstream unavailable"}'); });
  incoming.pipe(upstream);
});
proxy.listen(5275, '127.0.0.1', () => console.log('Isolated HTTPS test ingress ready on 5275'));
process.on('exit', () => rmSync(directory, { recursive: true, force: true }));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { proxy.close(() => process.exit(0)); setTimeout(() => process.exit(0), 2000).unref(); });
