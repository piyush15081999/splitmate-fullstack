// No credentials are included in validation errors or log output.
export function databaseSettings(connectionString: string, production = false) {
  let url: URL;
  try { url = new URL(connectionString); } catch { throw new Error('DATABASE_URL is invalid.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('DATABASE_URL must use PostgreSQL.');
  const neon = url.hostname.endsWith('.neon.tech');
  const pooled = neon && url.hostname.includes('-pooler.');
  const local = ['localhost', '127.0.0.1', '[::1]', 'db', 'test-db'].includes(url.hostname);
  const tls = neon || (production && !local);
  if (tls) {
    if (!['require', 'verify-full', 'verify-ca'].includes(url.searchParams.get('sslmode') ?? '')) throw new Error('Remote production PostgreSQL requires TLS; retain sslmode=require.');
    for (const key of ['sslcert', 'sslkey', 'sslrootcert']) if (url.searchParams.has(key)) throw new Error('Custom database certificates are not configured; use the standard Neon TLS URL.');
    // pg connection-string SSL flags otherwise override the explicit verified TLS object.
    for (const key of ['sslmode', 'ssl', 'uselibpqcompat', 'sslaccept', 'channel_binding']) url.searchParams.delete(key);
  }
  return {
    connectionString: tls ? url.toString() : connectionString,
    connectionTimeoutMillis: neon ? 30_000 : 10_000,
    idleTimeoutMillis: 30_000,
    max: 5,
    ...(tls ? { ssl: { rejectUnauthorized: true }, enableChannelBinding: true } : {}),
    // PgBouncer transaction pooling cannot promise per-session SQL settings.
    ...(!pooled ? { statement_timeout: 10_000 } : {}),
  };
}
