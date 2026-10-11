import { Type, FormatRegistry, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { VillageStateSchema, type VillageState } from './villages.js';

if (!FormatRegistry.Has('uuid')) FormatRegistry.Set('uuid', value => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value));
if (!FormatRegistry.Has('date-time')) FormatRegistry.Set('date-time', value => /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)));
export const villageSnapshotIsValid = (value: unknown): value is VillageState => Value.Check(VillageStateSchema, value);

const Path = Type.Array(Type.String());
export const VillageFrameSchema = Type.Object({
  worldId: Type.String({ format: 'uuid' }), villageId: Type.String({ format: 'uuid' }),
  fromRevision: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  toRevision: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  changes: Type.Array(Type.Union([
    Type.Object({ kind: Type.Literal('set'), path: Path, value: Type.Unknown() }),
    Type.Object({ kind: Type.Literal('remove'), path: Path }),
    Type.Object({ kind: Type.Literal('entities'), path: Path, upsert: Type.Array(Type.Unknown()),
      remove: Type.Array(Type.String()), order: Type.Optional(Type.Array(Type.String())) }),
  ])),
});
export type VillageFrame = Static<typeof VillageFrameSchema>;
export const VillageSyncBaseSchema = Type.Object({
  revision: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  serverTime: Type.String({ format: 'date-time' }),
});
export type VillageSyncBase = Static<typeof VillageSyncBaseSchema>;
const commandMetadata = { commandId: Type.Optional(Type.String({ format: 'uuid' })),
  commandTime: Type.String({ format: 'date-time' }), serverTime: Type.String({ format: 'date-time' }) };
export const VillageCommandResponseSchema = Type.Union([
  Type.Object({ ...commandMetadata, kind: Type.Literal('frame'), frame: VillageFrameSchema }),
  Type.Object({ ...commandMetadata, kind: Type.Literal('snapshot'), state: VillageStateSchema }),
]);
export type VillageCommandResponse = Static<typeof VillageCommandResponseSchema>;
export const villageCommandResponseIsValid = (value: unknown): value is VillageCommandResponse => Value.Check(VillageCommandResponseSchema, value);
type Change = VillageFrame['changes'][number];
const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function entityKey(v: unknown): string | null {
  if (!record(v)) return null;
  for (const key of ['id', 'featureId', 'code', 'buildingId']) if (typeof v[key] === 'string') return key + ':' + v[key];
  return typeof v.cellX === 'number' && typeof v.cellY === 'number' ? `cell:${v.cellX}:${v.cellY}` : null;
}
function entities(values: unknown[]): Map<string, unknown> | null {
  const result = new Map<string, unknown>();
  for (const value of values) { const key = entityKey(value); if (key === null || result.has(key)) return null; result.set(key, value); }
  return result;
}
function diff(a: unknown, b: unknown, path: string[], changes: Change[]): void {
  if (equal(a, b)) return;
  if (Array.isArray(a) && Array.isArray(b)) {
    const before = entities(a), after = entities(b);
    if (before && after) {
      const order = [...after.keys()];
      changes.push({ kind: 'entities', path, upsert: [...after].filter(([k, v]) => !equal(before.get(k), v)).map(([, v]) => v),
        remove: [...before.keys()].filter(k => !after.has(k)), ...(!equal([...before.keys()], order) ? { order } : {}) });
      return;
    }
  }
  if (record(a) && record(b)) {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (path.length === 0 && key === 'syncRevision') continue;
      if (!(key in b)) changes.push({ kind: 'remove', path: [...path, key] });
      else diff(a[key], b[key], [...path, key], changes);
    }
  } else changes.push({ kind: 'set', path, value: b });
}
export function villageFrame(before: VillageState, after: VillageState): VillageFrame {
  if (before.world.id !== after.world.id || before.village.id !== after.village.id
    || before.syncRevision === undefined || after.syncRevision === undefined || after.syncRevision <= before.syncRevision)
    throw Error('Invalid village frame context/revisions');
  const changes: Change[] = []; diff(before, after, [], changes);
  return { worldId: after.world.id, villageId: after.village.id, fromRevision: before.syncRevision, toRevision: after.syncRevision, changes };
}
function edit(root: unknown, path: string[], change: Change): unknown {
  if (!path.length) {
    if (change.kind === 'set') return change.value;
    if (change.kind === 'remove') return undefined;
    if (!Array.isArray(root)) throw Error('Expected entity collection');
    const map = entities(root); if (!map) throw Error('Invalid entity keys');
    for (const key of change.remove) { if (!map.delete(key)) throw Error('Missing removed entity'); }
    for (const value of change.upsert) { const key = entityKey(value); if (key === null) throw Error('Invalid entity'); map.set(key, value); }
    const order = change.order ?? [...map.keys()];
    if (new Set(order).size !== map.size || order.length !== map.size || order.some(k => !map.has(k))) throw Error('Invalid entity order');
    return order.map(k => map.get(k));
  }
  if (!record(root)) throw Error('Invalid patch path');
  const [key, ...rest] = path;
  if (!key || ['__proto__', 'constructor', 'prototype', 'syncRevision'].includes(key)) throw Error('Unsafe patch path');
  const next = { ...root }, value = edit(root[key], rest, change);
  if (value === undefined) delete next[key]; else next[key] = value;
  return next;
}
export type VillageFrameResult = { kind: 'applied'; state: VillageState } | { kind: 'ignored' | 'resync' };
/** Context selection is authorized by the caller; within a context, revision
 * wins over the timestamp of a potentially delayed projection. */
export function latestVillageSnapshot(before: VillageState | null, after: VillageState | null): VillageState | null {
  if (!after) return before;
  if (!before || before.world.id!==after.world.id || before.village.id!==after.village.id) return after;
  if (before.syncRevision!==undefined) return after.syncRevision!==undefined&&(after.syncRevision>before.syncRevision
    ||after.syncRevision===before.syncRevision&&after.serverTime>before.serverTime) ? after : before;
  return after.syncRevision!==undefined||after.serverTime>=before.serverTime ? after : before;
}
/** Build and validate the complete next state before exposing either data or revision. */
export function applyVillageFrame(state: VillageState, input: unknown): VillageFrameResult {
  if (!Value.Check(VillageFrameSchema, input)) return { kind: 'resync' };
  const frame = input;
  if (frame.worldId !== state.world.id || frame.villageId !== state.village.id) return { kind: 'ignored' };
  if (state.syncRevision === undefined || frame.toRevision <= frame.fromRevision) return { kind: 'resync' };
  if (frame.toRevision <= state.syncRevision) return { kind: 'ignored' };
  if (frame.fromRevision !== state.syncRevision) return { kind: 'resync' };
  try {
    let next: unknown = state;
    for (const change of frame.changes) next = edit(next, change.path, change);
    if (!record(next)) return { kind: 'resync' };
    next = { ...next, syncRevision: frame.toRevision };
    if (!Value.Check(VillageStateSchema, next) || next.world.id !== state.world.id || next.village.id !== state.village.id)
      return { kind: 'resync' };
    return { kind: 'applied', state: next };
  } catch { return { kind: 'resync' }; }
}

/** Preserve references on resets too, so presentation caches retain unchanged entities. */
export function reconcileVillageSnapshot(before: VillageState | null, after: VillageState): VillageState {
  if (!before || before.world.id !== after.world.id || before.village.id !== after.village.id) return after;
  function share(a: unknown, b: unknown): unknown {
    if (equal(a, b)) return a;
    if (Array.isArray(a) && Array.isArray(b)) {
      const keyed = entities(a);
      return b.map((v, i) => share(keyed?.get(entityKey(v) ?? '') ?? a[i], v));
    }
    if (record(a) && record(b)) return Object.fromEntries(Object.entries(b).map(([k, v]) => [k, share(a[k], v)]));
    return b;
  }
  return share(before, after) as VillageState;
}
