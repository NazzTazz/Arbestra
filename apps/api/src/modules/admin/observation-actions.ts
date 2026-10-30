import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ObservationAction } from '@arbestra/contracts';
import { HttpError } from '../../errors.js';
import type { ObservationHub } from './observation-hub.js';
import type { JourneyCommand, JourneyJournal, JourneyOutcome } from './journey-journal.js';

const actions = new WeakMap<FastifyRequest, ObservationAction>();
/** Requests bound to an active NOC observation: only these reach the hub. */
const observed = new WeakSet<FastifyRequest>();
const context = new AsyncLocalStorage<{
  hub: ObservationHub;
  journaling: boolean;
  request: FastifyRequest;
  kind: string;
  at: string;
  accountId?: string;
}>();
export function observationAuthenticated(accountId: string) {
  const current = context.getStore();
  if (current) current.accountId = accountId;
}
/** Bind only facts already authorized by the normal ownership read. No extra SQL. */
export function observationVillage(accountId: string, worldId: string, villageId: string) {
  const current = context.getStore();
  if (!current || current.accountId !== accountId || actions.has(current.request)) return;
  if ((current.request.params as { villageId?: string }).villageId !== villageId) return;
  const watched = current.hub.collecting && current.hub.active(worldId, villageId, accountId);
  if (!watched && !current.journaling) return;
  const { request, kind, hub } = current,
    body = request.body as Record<string, unknown> | undefined;
  const action: ObservationAction = {
    id: randomUUID(),
    requestId: request.id,
    worldId,
    villageId,
    accountId,
    at: current.at,
    kind,
    businessOutcome: 'unknown',
    httpOutcome: 'pending',
  };
  const commandId = body?.commandId ?? request.headers['x-arbestra-command'];
  if (typeof commandId === 'string' && /^[\da-f-]{36}$/i.test(commandId)) action.commandId = commandId;
  const target = (body?.target ?? body) as { cellX?: unknown; cellY?: unknown } | undefined;
  if (target && typeof target.cellX === 'number' && typeof target.cellY === 'number')
    action.target = { cellX: target.cellX, cellY: target.cellY };
  actions.set(request, action);
  if (watched) {
    observed.add(request);
    hub.record(action);
  }
}
/** Called immediately after a command transaction resolves, before transport projection. */
export function observationCommitted(request: FastifyRequest) {
  const action = actions.get(request);
  if (action) action.businessOutcome = 'accepted';
}
export function observationCommandKind(route: string): string | null {
  if (!route.startsWith('/api/worlds/:worldSlug/villages/:villageId/') || route.endsWith('/preview')) return null;
  const tail = route.split('/:villageId/')[1]!;
  if (
    /^(buildings(?:\/:buildingId\/(?:upgrade|expansions|discover-supplies))?|harvest-intents(?:\/:commandId\/cancel)?|extraction-pools|market\/trades|processing|infrastructure|exploitation|science|leveling|terraform|population\/gestures|worksites\/:worksiteId|discover-cat-eyes|starter)$/.test(
      tail,
    )
  )
    return tail;
  return null;
}
/** Journal type of a command kind: route parameters dropped, `/` → `.`
 * (`buildings/:buildingId/upgrade` → `buildings.upgrade`). */
export function journeyType(kind: string): string {
  return kind
    .split('/')
    .filter((part) => !part.startsWith(':'))
    .join('.');
}
const SUBJECT = /^[a-z0-9-]{1,40}$/;
/** Allow-listed catalogue code of a command: building type, else its action
 * (science, market, processing, population, pools, worksites). Never
 * coordinates, quantities or free text. */
export function journeySubject(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  for (const field of ['buildingType', 'action'] as const) {
    const value = (body as Record<string, unknown>)[field];
    if (typeof value === 'string' && SUBJECT.test(value)) return value;
  }
  return undefined;
}
function journeyOutcome(action: ObservationAction, finished: boolean): JourneyOutcome {
  if (action.businessOutcome === 'rejected') return 'rejected';
  if (action.businessOutcome === 'pending') return 'pending';
  if (action.businessOutcome === 'accepted' || action.businessOutcome === 'partial') return 'accepted';
  return finished ? 'error' : 'interrupted';
}
export function instrumentObservationActions(app: FastifyInstance, hub: ObservationHub, journal?: JourneyJournal) {
  app.addHook('onRoute', (options) => {
    if (![options.method].flat().includes('POST')) return;
    const kind = observationCommandKind(options.url);
    if (!kind) return;
    const handler = options.handler,
      type = journeyType(kind);
    options.handler = async function (request, reply) {
      const journaling = journal?.enabled === true;
      if (!hub.collecting && !journaling) return handler.call(this, request, reply);
      const body = request.body as Record<string, unknown> | undefined;
      let finished = false,
        settled = false,
        terminal = false,
        journaled = false;
      // One journal row per request, once both the handler (business outcome)
      // and the response (finished or cut) are over, whichever comes last.
      const journalize = () => {
        const action = actions.get(request);
        if (journaled || !settled || !terminal || !journaling || !action) return;
        journaled = true;
        const entry: JourneyCommand = {
          id: action.id,
          worldId: action.worldId,
          villageId: action.villageId,
          accountId: action.accountId,
          type,
          occurredAt: action.at,
          outcome: journeyOutcome(action, finished),
          attempts: 1,
        };
        if (action.commandId) entry.commandId = action.commandId;
        if (action.code && /^[A-Za-z0-9_-]{1,64}$/.test(action.code)) entry.code = action.code;
        if (finished) entry.statusCode = reply.statusCode;
        const subject = journeySubject(body);
        if (subject) entry.subject = subject;
        journal!.record(entry);
      };
      const finish = () => {
        finished = true;
        terminal = true;
        const action = actions.get(request);
        if (action && observed.has(request)) {
          action.httpOutcome = 'finished';
          action.statusCode = reply.statusCode;
          hub.record(action);
        }
        journalize();
      };
      reply.raw.once('finish', finish);
      reply.raw.once('close', () => {
        if (finished) return;
        terminal = true;
        const action = actions.get(request);
        if (action && observed.has(request)) {
          action.httpOutcome = 'interrupted';
          hub.record(action);
        }
        journalize();
      });
      try {
        const result = await context.run({ hub, journaling, request, kind, at: new Date().toISOString() }, () =>
          handler.call(this, request, reply),
        );
        const action = actions.get(request);
        if (!action) return result;
        if (action.businessOutcome === 'unknown')
          action.businessOutcome =
            (kind === 'science' && (body?.action === 'survey' || body?.action === 'explore')) ||
            kind === 'harvest-intents'
              ? 'pending'
              : 'accepted';
        if (observed.has(request)) hub.record(action);
        return result;
      } catch (error) {
        const action = actions.get(request);
        if (action) {
          if (error instanceof HttpError && action.businessOutcome === 'unknown' && error.statusCode < 500) {
            action.businessOutcome = 'rejected';
            action.code = error.code;
          }
          if (observed.has(request)) hub.record(action);
        }
        throw error;
      } finally {
        settled = true;
        journalize();
      }
    };
  });
}
