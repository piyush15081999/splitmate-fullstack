import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.js';
const frontend = mkdtempSync(join(tmpdir(), 'splitmate-static-test-'));
beforeAll(() => { mkdirSync(join(frontend, 'assets')); writeFileSync(join(frontend, 'index.html'), '<!doctype html><title>SplitMate test shell</title>'); writeFileSync(join(frontend, 'assets', 'app-test.js'), 'window.testAsset=true;'); writeFileSync(join(frontend, '.env'), 'FICTIONAL_PRIVATE_FIXTURE'); });
afterAll(() => { rmSync(frontend, { recursive: true, force: true }); });
describe('Production HTTP boundaries', () => {
  const probe = vi.fn().mockResolvedValue(undefined);
  const app = () => createApp(probe, undefined, { frontendDir: frontend, production: true, trustProxy: 1 });
  it('serves the shell for browser routes and HEAD, not arbitrary JSON requests', async () => {
    for (const route of ['/', '/login', '/groups/00000000-0000-4000-8000-000000000001']) { const response = await request(app()).get(route).set('Accept', 'text/html'); expect(response.status).toBe(200); expect(response.text).toContain('SplitMate test shell'); expect(response.headers['cache-control']).toBe('no-cache'); }
    expect((await request(app()).head('/groups/example').set('Accept', 'text/html')).status).toBe(200);
    expect((await request(app()).get('/not-a-browser-route').set('Accept', 'application/json')).status).toBe(404);
  });
  it('never turns API errors, non-GET mutations, missing assets or dotfiles into the shell', async () => {
    for (const route of ['/api/missing', '/api', '/assets/missing.js', '/missing.css', '/.env', '/%2eenv']) { const response = await request(app()).get(route).set('Accept', 'text/html'); expect([403,404]).toContain(response.status); expect(response.headers['content-type']).toContain('application/json'); expect(response.text).not.toContain('SplitMate test shell'); expect(response.text).not.toContain('FICTIONAL_PRIVATE_FIXTURE'); }
    expect((await request(app()).post('/groups/example').set('Accept', 'text/html').send({})).status).toBe(404);
    const api = await request(app()).get('/api/missing'); expect(api.body).toEqual({ error: 'Not found' });
  });
  it('sets production headers and immutable caching only for fingerprinted asset paths', async () => {
    const response = await request(app()).get('/');
    expect(response.headers['content-security-policy']).toContain("script-src 'self'"); expect(response.headers['content-security-policy']).not.toContain('unsafe-inline');
    expect(response.headers['strict-transport-security']).toBe('max-age=31536000'); expect(response.headers['x-frame-options']).toBe('DENY');
    const asset = await request(app()).get('/assets/app-test.js'); expect(asset.status).toBe(200); expect(asset.headers['cache-control']).toContain('immutable');
  });
  it('separates database-free liveness from database readiness', async () => {
    const failed = vi.fn().mockRejectedValue(new Error('private database URL'));
    const instance = createApp(failed, undefined, { production: true });
    expect((await request(instance).get('/healthz')).status).toBe(200); expect(failed).not.toHaveBeenCalled();
    const ready = await request(instance).get('/api/health'); expect(ready.status).toBe(503); expect(ready.text).not.toContain('private');
  });
  it('trusts only the nearest proxy and refuses missing frontend builds', () => {
    const trust = app().get('trust proxy fn') as (ip: string, hop: number) => boolean;
    expect(trust('127.0.0.1', 0)).toBe(true); expect(trust('198.51.100.1', 1)).toBe(false);
    expect(() => createApp(probe, undefined, { frontendDir: join(frontend, 'missing') })).toThrow('Frontend build is missing');
  });
});
