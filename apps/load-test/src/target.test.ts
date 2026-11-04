import { describe, expect, it } from 'vitest';
import { checkTarget, DEDICATED_VARIABLE, LoadTargetRefused, STAGING_VARIABLE } from './target.js';

const local = 'postgres://u:p@127.0.0.1:5432/arbestra_load';
const refused = (input: Parameters<typeof checkTarget>[0], message: RegExp) =>
  expect(() => checkTarget(input)).toThrowError(new RegExp(message.source));

describe('load-test target guards', () => {
  it('requires an explicit local or staging target', () => {
    refused({ target: undefined, databaseUrl: local, env: {} }, /Cible obligatoire/);
    refused({ target: 'prod', databaseUrl: local, env: {} }, /Cible obligatoire/);
    refused({ target: undefined, env: {} }, /--target dedicated/);
    expect(() => checkTarget({ target: undefined, env: {} })).toThrow(LoadTargetRefused);
  });

  it('accepts a dedicated local database and a local API of its own', () => {
    expect(
      checkTarget({
        target: 'local',
        databaseUrl: local,
        baseUrl: 'http://127.0.0.1:3300',
        worldSlug: 'charge',
        env: {},
      }),
    ).toEqual({
      target: 'local',
      database: { host: '127.0.0.1', name: 'arbestra_load' },
      api: { origin: 'http://127.0.0.1:3300' },
    });
    expect(
      checkTarget({ target: 'local', databaseUrl: 'postgres://u:p@localhost/arbestra_load_test', env: {} }).target,
    ).toBe('local');
  });

  it('never accepts the PO development or test databases, nor a remote one, locally', () => {
    refused({ target: 'local', databaseUrl: 'postgres://u:p@127.0.0.1:5432/arbestra', env: {} }, /base dédiée/);
    refused({ target: 'local', databaseUrl: 'postgres://u:p@127.0.0.1:5432/arbestra_test', env: {} }, /base dédiée/);
    refused({ target: 'local', databaseUrl: 'postgres://u:p@10.0.0.5:5432/arbestra_load', env: {} }, /locale/);
  });

  it('never accepts the PO dev API nor a remote API locally', () => {
    refused({ target: 'local', baseUrl: 'http://127.0.0.1:3000', env: {} }, /pnpm dev/);
    refused({ target: 'local', baseUrl: 'https://staging.arbestra.fr', env: {} }, /127\.0\.0\.1/);
    refused({ target: 'local', baseUrl: 'http://127.0.0.1:3300/api', env: {} }, /origine/);
  });

  it('blocks anything that names the alpha, whatever the target', () => {
    for (const target of ['local', 'staging'])
      for (const input of [
        { databaseUrl: 'postgres://u:p@127.0.0.1/arbestra_alpha' },
        { baseUrl: 'https://alpha.arbestra.world' },
        { baseUrl: 'https://ALPHA.arbestra.world' },
        { worldSlug: 'alpha-rc1' },
        { databaseUrl: 'postgres://u:p@127.0.0.1/%61lpha_load' },
      ])
        refused({ target, ...input, confirmStaging: true, env: { [STAGING_VARIABLE]: 'alpha-rc1' } }, /alpha/);
    // The alpha API port on the VPS, without its name in the URL.
    refused(
      {
        target: 'staging',
        baseUrl: 'http://127.0.0.1:3100',
        confirmStaging: true,
        worldSlug: 'charge',
        env: { [STAGING_VARIABLE]: 'charge' },
      },
      /alpha/,
    );
  });

  it('requires the confirmation flag and the dedicated variable naming the world for staging', () => {
    const staging = {
      target: 'staging',
      databaseUrl: 'postgres://u:p@127.0.0.1:5432/arbestra_staging',
      baseUrl: 'http://127.0.0.1:3200',
      worldSlug: 'charge',
    };
    refused({ ...staging, env: { [STAGING_VARIABLE]: 'charge' } }, /--confirm-staging/);
    refused({ ...staging, confirmStaging: true, env: {} }, new RegExp(STAGING_VARIABLE));
    refused(
      { ...staging, confirmStaging: true, env: { [STAGING_VARIABLE]: 'beta-rc1' } },
      new RegExp(STAGING_VARIABLE),
    );
    expect(checkTarget({ ...staging, confirmStaging: true, env: { [STAGING_VARIABLE]: 'charge' } }).target).toBe(
      'staging',
    );
    expect(
      checkTarget({
        ...staging,
        baseUrl: 'https://staging.arbestra.fr',
        confirmStaging: true,
        env: { [STAGING_VARIABLE]: 'charge' },
      }).api,
    ).toEqual({ origin: 'https://staging.arbestra.fr' });
    refused(
      {
        ...staging,
        databaseUrl: 'postgres://u:p@127.0.0.1/arbestra_load',
        confirmStaging: true,
        env: { [STAGING_VARIABLE]: 'charge' },
      },
      /arbestra_staging/,
    );
    refused(
      { ...staging, baseUrl: 'https://play.arbestra.fr', confirmStaging: true, env: { [STAGING_VARIABLE]: 'charge' } },
      /staging\.arbestra\.fr/,
    );
  });

  it('accepts several staging worlds when the variable lists them all', () => {
    const staging = {
      target: 'staging',
      baseUrl: 'https://staging.arbestra.fr',
      confirmStaging: true,
      env: { [STAGING_VARIABLE]: 'charge-1, charge-2' },
    };
    expect(checkTarget({ ...staging, worldSlug: 'charge-1' }).target).toBe('staging');
    expect(checkTarget({ ...staging, worldSlug: 'charge-2' }).target).toBe('staging');
    refused({ ...staging, worldSlug: 'charge-3' }, new RegExp(STAGING_VARIABLE));
    refused({ ...staging, worldSlug: 'charge' }, new RegExp(STAGING_VARIABLE));
  });

  describe('dedicated test machine', () => {
    const dedicated = {
      target: 'dedicated',
      databaseUrl: 'postgres://u:p@127.0.0.1:5432/arbestra_load',
      baseUrl: 'http://203.0.113.7:3400',
      worldSlug: 'charge-1',
      confirmDedicated: true,
      env: { [DEDICATED_VARIABLE]: '203.0.113.7' },
    };
    it('accepts a machine of its own named by the host variable, with the confirmation flag', () => {
      expect(checkTarget(dedicated)).toEqual({
        target: 'dedicated',
        database: { host: '127.0.0.1', name: 'arbestra_load' },
        api: { origin: 'http://203.0.113.7:3400' },
      });
      expect(
        checkTarget({
          ...dedicated,
          baseUrl: 'https://load.example.net',
          env: { [DEDICATED_VARIABLE]: 'LOAD.example.net' },
        }).target,
      ).toBe('dedicated');
    });
    it('requires the flag and a variable that matches the API host', () => {
      refused({ ...dedicated, confirmDedicated: false }, /--confirm-dedicated/);
      refused({ ...dedicated, env: {} }, new RegExp(DEDICATED_VARIABLE));
      refused({ ...dedicated, env: { [DEDICATED_VARIABLE]: '203.0.113.8' } }, /ne correspond pas/);
    });
    it('refuses the alpha and the staging, by name, domain, port or database', () => {
      const local = { [DEDICATED_VARIABLE]: '127.0.0.1' };
      refused({ ...dedicated, baseUrl: 'https://alpha.arbestra.world' }, /alpha/);
      refused(
        { ...dedicated, baseUrl: 'https://staging.arbestra.fr', env: { [DEDICATED_VARIABLE]: 'staging.arbestra.fr' } },
        /staging/,
      );
      refused(
        { ...dedicated, baseUrl: 'https://play.arbestra.fr', env: { [DEDICATED_VARIABLE]: 'play.arbestra.fr' } },
        /domaine public/,
      );
      refused({ ...dedicated, databaseUrl: 'postgres://u:p@127.0.0.1/arbestra_staging' }, /staging/);
      refused({ ...dedicated, databaseUrl: 'postgres://u:p@127.0.0.1/arbestra_alpha' }, /alpha/);
      refused({ ...dedicated, worldSlug: 'staging' }, /staging/);
      refused({ ...dedicated, worldSlug: 'alpha' }, /alpha/);
      refused({ ...dedicated, baseUrl: 'http://127.0.0.1:3100', env: local }, /alpha/);
      refused({ ...dedicated, baseUrl: 'http://127.0.0.1:3200', env: local }, /staging ou/);
      refused({ ...dedicated, env: { [DEDICATED_VARIABLE]: 'staging' } }, /staging/);
    });
    it('only accepts a database created for the test', () => {
      refused({ ...dedicated, databaseUrl: 'postgres://u:p@127.0.0.1/arbestra' }, /_load/);
      refused({ ...dedicated, databaseUrl: 'postgres://u:p@10.0.0.5/arbestra_load' }, /locale/);
    });
  });
});
