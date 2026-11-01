import type { FastifyRequest } from 'fastify';
import { HttpError } from '../../errors.js';

/** What an old tab shows its player: it only displays `error.message`. */
export const CLIENT_UPGRADE_MESSAGE = "Une nouvelle version d'Arbestra est disponible. Rechargez la page.";
export const CLIENT_UPGRADE_CODE = 'CLIENT_UPGRADE_REQUIRED';
/** RFC 9110 §15.5.22: a 426 names the protocol the client must move to. */
export const CLIENT_UPGRADE_PROTOCOL = 'arbestra-sync/2';

export const clientUpgradeRequired = () => new HttpError(426, CLIENT_UPGRADE_CODE, CLIENT_UPGRADE_MESSAGE);

/**
 * `onRequest` gate of the commands that used to have a historical answer. It
 * runs before authentication, validation and any transaction: a refused
 * request executes nothing and consumes no command identifier, so the page's
 * own reload replays the intention under V2. Cheap on purpose: a stale tab
 * keeps asking every few seconds.
 */
export async function requireProtocolV2(request: FastifyRequest): Promise<void> {
  if (request.headers['x-arbestra-protocol'] !== '2') throw clientUpgradeRequired();
}

/** Science also carries expedition receipts (survey, explore), which have no protocol header. */
export async function requireProtocolV2ExceptExpeditions(request: FastifyRequest): Promise<void> {
  const action = (request.body as { action?: unknown } | null | undefined)?.action;
  if (action === 'survey' || action === 'explore') return;
  return requireProtocolV2(request);
}

/** Retired reads (`GET /village`, the `/events` stream): refused for every caller. */
export async function refuseRetiredRead(): Promise<never> {
  throw clientUpgradeRequired();
}
