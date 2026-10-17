import { describe, expect, it } from 'vitest';
import { runtimeConfig, migrationDatabaseUrl } from '../src/runtime-config.js';
import { databaseSettings } from '../src/database-settings.js';
const local = { DATABASE_URL: 'postgresql://fictional:local@db/splitmate_test' };
const cloud = { DATABASE_URL: 'postgresql://fictional:example@ep-demo-pooler.eu.neon.tech/demo?sslmode=require', DIRECT_DATABASE_URL: 'postgresql://fictional:example@ep-demo.eu.neon.tech/demo?sslmode=require', NODE_ENV: 'production', WEB_ORIGIN: 'https://splitmate-example.onrender.com', COOKIE_SECURE: 'true', TRUST_PROXY: '1', RENDER: 'true', PORT: '10000' };
describe('Production runtime configuration', () => {
  it('retains local defaults and uses the production interface and platform port', () => { expect(runtimeConfig(local)).toMatchObject({ host: '127.0.0.1', port: 3001, production: false, trustProxy: 0 }); expect(runtimeConfig(cloud)).toMatchObject({ host: '0.0.0.0', port: 10000, secureCookies: true, production: true, trustProxy: 1 }); });
  it('rejects unsafe production origins, cookies, arbitrary proxy trust and invalid ports', () => {
    for (const patch of [{ WEB_ORIGIN: 'http://localhost:5173' }, { WEB_ORIGIN: 'https://example.test/' }, { WEB_ORIGIN: 'not a URL' }, { COOKIE_SECURE: 'false' }, { COOKIE_SECURE: 'yes' }, { TRUST_PROXY: 'true' }, { TRUST_PROXY: '0' }, { PORT: '0' }, { PORT: '1.5' }]) expect(() => runtimeConfig({ ...cloud, ...patch })).toThrow();
    expect(() => runtimeConfig({})).toThrow('DATABASE_URL is required');
  });
  it('selects explicit direct CLI connections and refuses pooled Neon migrations', () => {
    expect(migrationDatabaseUrl(local)).toBe(local.DATABASE_URL); expect(migrationDatabaseUrl(cloud)).toBe(cloud.DIRECT_DATABASE_URL);
    expect(() => migrationDatabaseUrl({ ...cloud, DIRECT_DATABASE_URL: undefined })).toThrow('direct Neon hostname');
    expect(() => migrationDatabaseUrl({ ...cloud, DIRECT_DATABASE_URL: cloud.DATABASE_URL })).toThrow('direct Neon hostname');
    expect(() => migrationDatabaseUrl({ ...cloud, DIRECT_DATABASE_URL: cloud.DIRECT_DATABASE_URL.replace('?sslmode=require', '') })).toThrow('TLS');
    expect(() => migrationDatabaseUrl({ NODE_ENV: 'production' })).toThrow('DIRECT_DATABASE_URL');
  });
  it('verifies cloud TLS without leaking credential values or disabling certificate validation', () => {
    const config = databaseSettings(cloud.DATABASE_URL, true); expect(config.ssl).toEqual({ rejectUnauthorized: true }); expect(config.enableChannelBinding).toBe(true); expect(config.max).toBe(5); expect(config.connectionTimeoutMillis).toBe(30000);
    expect(new URL(config.connectionString).searchParams.has('sslmode')).toBe(false);
    expect(() => databaseSettings('postgresql://fictional:private-value@ep-demo.neon.tech/demo', true)).toThrow('TLS');
    try { databaseSettings('postgresql://fictional:private-value@ep-demo.neon.tech/demo', true); } catch (error) { expect(String(error)).not.toContain('private-value'); }
    expect(() => databaseSettings('mysql://fictional:private-value@db/demo')).toThrow('PostgreSQL');
  });
  it('keeps the direct local statement timeout without relying on pooled session settings', () => {
    expect(databaseSettings(local.DATABASE_URL).statement_timeout).toBe(10000);
    expect(databaseSettings(cloud.DATABASE_URL, true).statement_timeout).toBeUndefined();
    expect(databaseSettings(cloud.DIRECT_DATABASE_URL, true).statement_timeout).toBe(10000);
  });
});

describe('Neon direct URL compatibility and target safety', () => {
  it('accepts DIRECT_URL while preserving the existing explicit alias', () => {
    expect(migrationDatabaseUrl({ ...cloud, DIRECT_DATABASE_URL: undefined, DIRECT_URL: cloud.DIRECT_DATABASE_URL })).toBe(cloud.DIRECT_DATABASE_URL);
    expect(migrationDatabaseUrl({ ...cloud, DIRECT_URL: cloud.DIRECT_DATABASE_URL })).toBe(cloud.DIRECT_DATABASE_URL);
    expect(migrationDatabaseUrl({ ...local, DIRECT_URL: local.DATABASE_URL })).toBe(local.DATABASE_URL);
  });
  it('refuses conflicting direct variables without exposing their values', () => {
    expect(() => migrationDatabaseUrl({ ...cloud, DIRECT_URL: cloud.DIRECT_DATABASE_URL.replace('/demo?', '/other?') })).toThrow('conflict');
  });
  it('refuses mixed local/cloud targets and mismatched Neon databases, endpoints or roles', () => {
    for (const runtime of [local.DATABASE_URL, cloud.DATABASE_URL.replace('/demo?', '/other?'), cloud.DATABASE_URL.replace('ep-demo-pooler', 'ep-other-pooler'), cloud.DATABASE_URL.replace('fictional:', 'another:')]) {
      expect(() => migrationDatabaseUrl({ ...cloud, DATABASE_URL: runtime })).toThrow('same endpoint');
    }
  });
});
