import { existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import express, { type ErrorRequestHandler } from 'express';
import { Prisma, type PrismaClient } from './generated/prisma/client.js';
import { HttpError } from './errors.js';
import { createRoutes } from './routes.js';

// Deliberately omit raw messages, SQL, request bodies, credentials and stack traces.
export function serverErrorMetadata(error: unknown, method: string, route: string) {
  const code = error instanceof Prisma.PrismaClientKnownRequestError && /^P\d{4}$/.test(error.code) ? error.code : 'UNEXPECTED';
  const kind = error instanceof Prisma.PrismaClientKnownRequestError ? 'PRISMA_KNOWN' : error instanceof Prisma.PrismaClientUnknownRequestError ? 'PRISMA_UNKNOWN' : error instanceof Prisma.PrismaClientInitializationError ? 'PRISMA_INIT' : error instanceof Error ? 'ERROR' : 'UNKNOWN';
  const timedOut = error instanceof Error && /timeout|timed out/i.test(error.message);
  return { event: 'api_error', method, route, code, kind, timedOut };
}

// Dependency injection keeps HTTP tests deterministic and independent of PostgreSQL.
export function createApp(checkDatabase: () => Promise<void>, options?: { prisma: PrismaClient; webOrigin: string; secureCookies: boolean }, hosting: { production?: boolean; frontendDir?: string; trustProxy?: 0 | 1 } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', hosting.trustProxy ?? 0);
  if (hosting.frontendDir && !existsSync(join(hosting.frontendDir, 'index.html'))) throw new Error('Frontend build is missing. Run npm run build before starting production.');
  app.use((_req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'Cross-Origin-Resource-Policy': 'same-origin' });
    if (hosting.production) res.set({
      'Content-Security-Policy': "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'; form-action 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; upgrade-insecure-requests",
      'Strict-Transport-Security': 'max-age=31536000',
      'X-Frame-Options': 'DENY',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    });
    next();
  });
  // Liveness avoids waking a sleeping Neon compute for platform health probes.
  app.get('/healthz', (_req, res) => { res.set('Cache-Control', 'no-store').json({ status: 'ok', service: 'splitmate' }); });
  app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.use(express.json({ limit: '16kb' }));
  app.get('/api/health', async (_request, response) => {
    try {
      await checkDatabase();
      response.status(200).json({ status: 'ok', service: 'splitmate-api', database: 'up' });
    } catch {
      response.status(503).json({ status: 'error', service: 'splitmate-api', database: 'down' });
    }
  });
  if (options) app.use('/api', createRoutes(options.prisma, options.webOrigin, options.secureCookies));
  // Reserve API paths before static/SPA handling: missing APIs always stay JSON.
  app.use('/api', (_req, res) => { res.status(404).json({ error: 'Not found' }); });
  if (hosting.frontendDir) {
    const frontend = hosting.frontendDir;
    app.use('/assets', express.static(join(frontend, 'assets'), { immutable: true, maxAge: '1y', index: false, dotfiles: 'deny' }));
    app.use(express.static(frontend, { index: false, dotfiles: 'deny', maxAge: 0, setHeaders(res) { res.setHeader('Cache-Control', 'no-cache'); } }));
    app.use((req, res, next) => {
      const pathname = decodeURIComponent(req.path);
      if (!['GET', 'HEAD'].includes(req.method) || !req.accepts('html') || pathname === '/assets' || pathname.startsWith('/assets/') || pathname.split('/').some(segment => segment.startsWith('.')) || extname(pathname)) return next();
      res.set('Cache-Control', 'no-cache');
      res.sendFile(join(frontend, 'index.html'));
    });
  }
  app.use((_request, response) => {
    response.status(404).json({ error: 'Not found' });
  });
  const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
    if (error instanceof HttpError) {
      if (error.status === 429) response.set('Retry-After', String(error.retryAfter));
      response.status(error.status).json({ error: error.message });
      return;
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') { response.status(409).json({ error: 'This email is already registered, or this user is already a group member.' }); return; }
      if (error.code === 'P2034' || error.code === 'P2003') { response.status(409).json({ error: 'The group changed or has financial history. Refresh and try again.' }); return; }
    }
    const status = error instanceof SyntaxError || error instanceof URIError ? 400 : [403, 404, 413].includes(error?.status) ? error.status as number : 500;
    if (status === 500) console.error(serverErrorMetadata(error, _request.method, typeof _request.route?.path === 'string' ? _request.route.path : 'unknown'));
    response.status(status).json({ error: status === 400 ? 'Invalid JSON' : status === 413 ? 'Payload too large' : status === 403 ? 'Forbidden' : status === 404 ? 'Not found' : 'Internal server error' });
  };
  app.use(errorHandler);
  return app;
}
