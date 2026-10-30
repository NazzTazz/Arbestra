import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const base = { DATABASE_URL: 'postgres://unused/unused_test', NODE_ENV: 'production' };
const id = 'c12da950-b066-4dd0-8bda-eb576f77c92a';

describe('administrator and proxy configuration', () => {
  it('accepts an explicit world origin and rejects unsafe production observation destinations', () => {
    expect(loadConfig({ ...base, WORLD_ORIGIN: 'https://alpha.arbestra.world/' }).worldOrigin).toBe(
      'https://alpha.arbestra.world',
    );
    for (const WORLD_ORIGIN of [
      'http://alpha.arbestra.world',
      'https://user:secret@alpha.arbestra.world',
      'https://alpha.arbestra.world/village',
      'https://alpha.arbestra.world/?token=x',
    ])
      expect(() => loadConfig({ ...base, WORLD_ORIGIN })).toThrow();
  });
  it('accepts a per-world subdomain template only as the first host label', () => {
    expect(loadConfig({ ...base, WORLD_ORIGIN: 'https://{world}.arbestra.world/' }).worldOrigin).toBe(
      'https://{world}.arbestra.world',
    );
    for (const WORLD_ORIGIN of [
      'http://{world}.arbestra.world',
      'https://arbestra.world/{world}',
      'https://play.{world}.arbestra.world',
      'https://{world}.arbestra.world/village',
    ])
      expect(() => loadConfig({ ...base, WORLD_ORIGIN })).toThrow();
  });
  it('enables safe HTTP anomaly logs in both environments and validates all diagnostic settings', () => {
    for (const NODE_ENV of ['development', 'production']) {
      expect(loadConfig({ ...base, NODE_ENV })).toMatchObject({ nocHttpSlowMs: 2000, nocHttpLogMode: 'anomalies' });
      expect(loadConfig({ ...base, NODE_ENV, NOC_HTTP_SLOW_MS: '250', NOC_HTTP_LOG_MODE: 'off' })).toMatchObject({
        nocHttpSlowMs: 250,
        nocHttpLogMode: 'off',
      });
    }
    expect(loadConfig({ ...base, NOC_HTTP_SLOW_MS: '60000' }).nocHttpSlowMs).toBe(60000);
    for (const value of ['', '249', '60001', '1.5', '2000ms', 'Infinity', '-1', ' 2000']) {
      expect(() => loadConfig({ ...base, NOC_HTTP_SLOW_MS: value })).toThrow(/NOC_HTTP_SLOW_MS/);
    }
    for (const value of ['', 'all', 'OFF', 'false']) {
      expect(() => loadConfig({ ...base, NOC_HTTP_LOG_MODE: value })).toThrow(/NOC_HTTP_LOG_MODE/);
    }
  });
  it('grants no administrator and trusts no proxy by default', () => {
    expect(loadConfig(base)).toMatchObject({ adminAccountIds: [], trustedProxyCidrs: [] });
  });

  it('accepts only explicit account UUIDs and canonicalizes duplicates', () => {
    expect(
      loadConfig({
        ...base,
        ADMIN_ACCOUNT_IDS: `${id}, ${id.toUpperCase()}`,
        ADMIN_ORIGIN: 'https://admin.example.test/',
      }),
    ).toMatchObject({ adminAccountIds: [id], adminOrigin: 'https://admin.example.test' });
    for (const value of ['admin@example.test', '*', `${id},`, '00000000-0000-0000-0000-000000000000']) {
      expect(() => loadConfig({ ...base, ADMIN_ACCOUNT_IDS: value })).toThrow(/ADMIN_ACCOUNT_IDS/);
    }
  });

  it('requires an exact configured HTTPS origin before production access is enabled', () => {
    for (const origin of [
      undefined,
      'http://admin.example.test',
      'https://user:password@admin.example.test',
      'https://admin.example.test/path',
      'https://admin.example.test/?token=x',
      'https://admin.example.test/#fragment',
      'garbage',
    ]) {
      expect(() => loadConfig({ ...base, ADMIN_ACCOUNT_IDS: id, ...(origin ? { ADMIN_ORIGIN: origin } : {}) })).toThrow(
        /ADMIN_ORIGIN/,
      );
    }
  });

  it('accepts explicit proxy IPs and CIDRs while rejecting global trust and malformed lists', () => {
    expect(loadConfig({ ...base, TRUSTED_PROXY_CIDRS: '127.0.0.1,::1,192.0.2.0/24' }).trustedProxyCidrs).toEqual([
      '127.0.0.1',
      '::1',
      '192.0.2.0/24',
    ]);
    for (const value of ['true', '*', '0.0.0.0/0', '::/0', '127.0.0.1,', '192.0.2.0/33', '::1/129', 'localhost']) {
      expect(() => loadConfig({ ...base, TRUSTED_PROXY_CIDRS: value })).toThrow(/TRUSTED_PROXY_CIDRS/);
    }
  });

  it('keeps the player journey journal off unless JOURNEY_ENABLED=1', () => {
    expect(loadConfig(base).journeyEnabled).toBe(false);
    expect(loadConfig({ ...base, JOURNEY_ENABLED: '0' }).journeyEnabled).toBe(false);
    expect(loadConfig({ ...base, JOURNEY_ENABLED: '1' }).journeyEnabled).toBe(true);
    for (const value of ['true', 'yes', '2'])
      expect(() => loadConfig({ ...base, JOURNEY_ENABLED: value })).toThrow(/JOURNEY_ENABLED/);
  });
});
