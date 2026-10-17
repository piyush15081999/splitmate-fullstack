type Environment = Record<string, string | undefined>;
export function runtimeConfig(env: Environment) {
  const production = env.NODE_ENV === 'production';
  const port = Number(env.PORT ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer between 1 and 65535.');
  const webOrigin = env.WEB_ORIGIN ?? 'http://localhost:5173';
  let origin: URL;
  try { origin = new URL(webOrigin); } catch { throw new Error('WEB_ORIGIN must be an exact HTTP(S) origin.'); }
  if (origin.origin !== webOrigin || !['http:', 'https:'].includes(origin.protocol)) throw new Error('WEB_ORIGIN must be an exact HTTP(S) origin without a trailing slash.');
  if (env.COOKIE_SECURE && !['true', 'false'].includes(env.COOKIE_SECURE)) throw new Error('COOKIE_SECURE must be true or false.');
  const secureCookies = env.COOKIE_SECURE === 'true';
  if (production && (!secureCookies || origin.protocol !== 'https:')) throw new Error('Production authentication requires HTTPS and COOKIE_SECURE=true.');
  if (env.TRUST_PROXY && !['0', '1'].includes(env.TRUST_PROXY)) throw new Error('TRUST_PROXY must be 0 or 1; never trust arbitrary forwarding headers.');
  const trustProxy = env.TRUST_PROXY === '1' ? 1 : 0;
  if (production && env.RENDER === 'true' && trustProxy !== 1) throw new Error('Render requires TRUST_PROXY=1 for its single trusted ingress.');
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required. See the environment examples.');
  return { production, port, webOrigin, secureCookies, trustProxy: trustProxy as 0 | 1, host: env.HOST ?? (production ? '0.0.0.0' : '127.0.0.1'), databaseUrl: env.DATABASE_URL };
}
export function migrationDatabaseUrl(env: Environment) {
  if (env.DIRECT_URL && env.DIRECT_DATABASE_URL && env.DIRECT_URL !== env.DIRECT_DATABASE_URL) throw new Error('DIRECT_URL and DIRECT_DATABASE_URL conflict; set only one direct migration URL.');
  const direct = env.DIRECT_URL || env.DIRECT_DATABASE_URL;
  const connection = direct || env.DATABASE_URL;
  if (!connection) {
    if (env.NODE_ENV === 'production') throw new Error('Production migrations require DIRECT_URL (or legacy DIRECT_DATABASE_URL).');
    return 'postgresql://splitmate:splitmate_local_only@localhost:5433/splitmate?schema=public';
  }
  let url: URL;
  try { url = new URL(connection); } catch { throw new Error('Migration database URL is invalid.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('Migration connection must use PostgreSQL.');
  if (url.hostname.endsWith('.neon.tech')) {
    if (url.hostname.includes('-pooler.')) throw new Error('Prisma migrations require the direct Neon hostname, not the pooler. Set DIRECT_URL (or legacy DIRECT_DATABASE_URL).');
    if (!['require', 'verify-full', 'verify-ca'].includes(url.searchParams.get('sslmode') ?? '')) throw new Error('Neon migrations require TLS: retain sslmode=require from the console URL.');
  }
  if (env.NODE_ENV === 'production' && !direct) throw new Error('Set DIRECT_URL (or legacy DIRECT_DATABASE_URL) explicitly for production migrations.');
  if (direct && env.DATABASE_URL) {
    let runtime: URL;
    try { runtime = new URL(env.DATABASE_URL); } catch { throw new Error('DATABASE_URL is invalid.'); }
    if (url.hostname.endsWith('.neon.tech') || runtime.hostname.endsWith('.neon.tech')) {
      if (!url.hostname.endsWith('.neon.tech') || !runtime.hostname.endsWith('.neon.tech') || runtime.hostname.replace('-pooler.', '.') !== url.hostname || runtime.pathname !== url.pathname || runtime.username !== url.username || runtime.port !== url.port) throw new Error('Neon runtime and migration URLs must target the same endpoint, database and role.');
    }
  }
  return connection;
}
