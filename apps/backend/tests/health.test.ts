import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '../src/generated/prisma/client.js';
import { createApp, serverErrorMetadata } from '../src/app.js';

describe('HTTP API', () => {
  it('reports readiness only after the database probe succeeds', async () => {
    const probe = vi.fn().mockResolvedValue(undefined);
    const response = await request(createApp(probe)).get('/api/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok', service: 'splitmate-api', database: 'up' });
    expect(probe).toHaveBeenCalledOnce();
    expect(response.headers['x-powered-by']).toBeUndefined();
  });
  it('returns 503 without exposing database credentials or errors', async () => {
    const response = await request(createApp(async () => { throw new Error('secret connection string'); })).get('/api/health');
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ status: 'error', service: 'splitmate-api', database: 'down' });
    expect(response.text).not.toContain('secret');
  });
  it('returns a JSON 404 for unimplemented functionality', async () => {
    const response = await request(createApp(async () => {})).post('/api/expenses').send({ amount: 10 });
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'Not found' });
  });
  it('handles malformed JSON', async () => {
    const response = await request(createApp(async () => {})).post('/api/expenses').set('Content-Type', 'application/json').send('{');
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Invalid JSON' });
  });
});


it('logs safe operation metadata without messages, parameters or credentials', () => {
  const secret = 'private-password-and-connection-string';
  const error = new Prisma.PrismaClientKnownRequestError(secret, { code: 'P2028', clientVersion: '7.10.0', meta: { password: secret } });
  const event = serverErrorMetadata(error, 'POST', '/auth/register');
  expect(event).toEqual({ event: 'api_error', method: 'POST', route: '/auth/register', code: 'P2028', kind: 'PRISMA_KNOWN', timedOut: false });
  expect(JSON.stringify(event)).not.toContain(secret);
  expect(serverErrorMetadata(new Error(secret), 'POST', '/groups').code).toBe('UNEXPECTED');
  const timeout = serverErrorMetadata(new Error('Query read timeout: ' + secret), 'GET', 'unknown');
  expect(timeout.timedOut).toBe(true); expect(JSON.stringify(timeout)).not.toContain(secret);
});
