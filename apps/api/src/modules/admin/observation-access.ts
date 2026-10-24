import { createHash, randomBytes } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';
import type { ObservationLease } from '@arbestra/contracts';
import type { Database } from '../../database/schema.js';
import type { AppConfig } from '../../config.js';
import { HttpError } from '../../errors.js';
import type { ObservationHub } from './observation-hub.js';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const secret = () => randomBytes(32).toString('base64url');
const denied = () =>
  new HttpError(
    401,
    'OBSERVATION_AUTH_REQUIRED',
    'Lien d’observation expiré ou indisponible. Rouvrez-le depuis le NOC.',
  );
type Binding = { leaseId: string; actorId: string; adminHash: string; worldSlug: string };
export const OBSERVER_COOKIE = 'arbestra_observer';

/** A one-use launch grant and a separate, context-bound read session. */
export class ObservationAccess {
  private grants = new Map<string, Binding & { expires: number }>();
  private sessions = new Map<string, Binding>();
  constructor(
    private hub: ObservationHub,
    private now = Date.now,
  ) {
    hub.onClose((l) => {
      for (const map of [this.grants, this.sessions])
        for (const [key, value] of map) if (value.leaseId === l.id) map.delete(key);
    });
  }
  /** The village client origin; a `{world}` template names the observed world's subdomain. */
  worldOrigin(config: AppConfig, worldSlug?: string) {
    if (config.worldOrigin) return worldSlug ? config.worldOrigin.replace('{world}', worldSlug) : config.worldOrigin;
    if (!config.isProduction && config.adminOrigin) {
      const url = new URL(config.adminOrigin);
      if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
        url.port = '5174';
        return url.origin;
      }
    }
    throw new HttpError(
      503,
      'ADMIN_DATA_UNAVAILABLE',
      'L’origine du client village doit être configurée (WORLD_ORIGIN).',
    );
  }
  /** Before the binding is known any world subdomain passes; the bound world is checked next. */
  private assertOrigin(request: FastifyRequest, config: AppConfig, worldSlug?: string) {
    const actual = `${request.protocol}://${request.host}`;
    const world = worldSlug ?? (this.worldOrigin(config).includes('{world}') ? request.host.split('.')[0] : undefined);
    const origin = this.worldOrigin(config, world);
    if (
      actual !== origin ||
      (config.isProduction && request.protocol !== 'https') ||
      request.headers['sec-fetch-site'] === 'cross-site' ||
      (request.headers.origin !== undefined && request.headers.origin !== origin) ||
      (!['GET', 'HEAD'].includes(request.method) && request.headers.origin !== origin)
    )
      throw new HttpError(403, 'INVALID_ORIGIN', 'Origine d’observation non autorisée.');
  }
  launch(config: AppConfig, lease: ObservationLease, actorId: string, adminHash: string) {
    const origin = this.worldOrigin(config, lease.worldSlug);
    this.sweep();
    // At most one unconsumed grant per bounded lease.
    for (const [key, value] of this.grants) if (value.leaseId === lease.id) this.grants.delete(key);
    const token = secret(),
      expires = this.now() + 30000;
    this.grants.set(digest(token), { leaseId: lease.id, actorId, adminHash, worldSlug: lease.worldSlug, expires });
    const url = new URL('/village', origin);
    if (!config.worldOrigin?.includes('{world}')) url.searchParams.set('world', lease.worldSlug);
    url.searchParams.set('observe', lease.id);
    url.hash = new URLSearchParams({ observationToken: token }).toString();
    return { url: url.href, expiresAt: new Date(expires).toISOString() };
  }
  private async principal(db: Kysely<Database>, config: AppConfig, binding: Binding) {
    if (!config.adminAccountIds?.includes(binding.actorId)) throw denied();
    const session = await db
      .selectFrom('sessions')
      .select('accountId')
      .where('tokenHash', '=', binding.adminHash)
      .where('accountId', '=', binding.actorId)
      .where('expiresAt', '>', new Date(this.now()))
      .executeTakeFirst();
    if (!session) throw denied();
    return { id: binding.actorId, permissions: ['noc:read'] as const };
  }
  async exchange(request: FastifyRequest, db: Kysely<Database>, config: AppConfig, token: string) {
    this.assertOrigin(request, config);
    this.sweep();
    const key = digest(token),
      grant = this.grants.get(key);
    if (!grant) throw denied();
    this.assertOrigin(request, config, grant.worldSlug);
    // Consume before awaiting: two concurrent exchanges cannot both succeed.
    this.grants.delete(key);
    await this.principal(db, config, grant);
    const lease = this.hub.get(grant.leaseId, grant.actorId),
      cookie = secret();
    // A concurrent close/revocation never resurrects the lease.
    this.sessions.set(digest(cookie), {
      leaseId: lease.id,
      actorId: grant.actorId,
      adminHash: grant.adminHash,
      worldSlug: grant.worldSlug,
    });
    this.hub.heartbeat(lease.id, grant.actorId);
    return { lease, cookie };
  }
  async authorize(request: FastifyRequest, db: Kysely<Database>, config: AppConfig, closeOnFailure = true) {
    this.assertOrigin(request, config);
    const token = request.cookies[OBSERVER_COOKIE],
      binding = token && this.sessions.get(digest(token));
    if (!binding || binding.leaseId !== (request.params as { id?: string }).id) throw denied();
    this.assertOrigin(request, config, binding.worldSlug);
    try {
      const principal = await this.principal(db, config, binding);
      this.hub.get(binding.leaseId, binding.actorId);
      return principal;
    } catch (error) {
      if (closeOnFailure) this.hub.close(binding.leaseId, 'authorization_revoked');
      throw error;
    }
  }
  private sweep() {
    for (const [key, value] of this.grants) if (value.expires <= this.now()) this.grants.delete(key);
  }
}
