import { describe, expect, it } from 'vitest';
import { checkTarget, LoadTargetRefused, STAGING_VARIABLE } from './target.js';

const local = 'postgres://u:p@127.0.0.1:5432/arbestra_load';
const refused = (input: Parameters<typeof checkTarget>[0], message: RegExp) =>
  expect(() => checkTarget(input)).toThrowError(new RegExp(message.source));

describe('load-test target guards', () => {
  it('requires an explicit local or staging target', () => {
    refused({ target: undefined, databaseUrl: local, env: {} }, /Cible obligatoire/);
    refused({ target: 'prod', databaseUrl: local, env: {} }, /Cible obligatoire/);
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
});
