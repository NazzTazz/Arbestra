import { expect, it, vi } from 'vitest';
import { ObservationHub } from './observation-hub.js';
import type { ObservationAction, ObservationPose } from '@arbestra/contracts';
const target = { worldId: 'world', villageId: 'village', accountId: 'owner', worldSlug: 'test', villageName: 'Test' };
const pose: ObservationPose = {
  mode: 'village',
  cellX: 2,
  cellY: 3,
  alpha: 1,
  beta: 0.8,
  radius: 20,
  altitude: 0,
  fov: 0.55,
};
it('keeps a stationary camera fresh for a minute, then suspends and expires the source', () => {
  let now = 100000;
  const h = new ObservationHub(() => now),
    l = h.create('admin', target),
    id = h.source('session', 'owner', 'world', 'village');
  h.publish('session', 'owner', 'world', 'village', { version: 1, sourceId: id, poseSequence: 1, visible: true, pose });
  const moved = h.status(l.id, 'admin').sources[0]!.lastPoseChangedAt;
  for (let i = 0; i < 12; i++) {
    now += 5000;
    h.heartbeat(l.id, 'admin');
    h.publish('session', 'owner', 'world', 'village', { version: 1, sourceId: id, poseSequence: 1, visible: true });
    expect(h.status(l.id, 'admin').sources[0]!.fresh).toBe(true);
  }
  expect(h.status(l.id, 'admin').sources[0]!.lastPoseChangedAt).toBe(moved);
  now += 15000;
  h.heartbeat(l.id, 'admin');
  expect(h.status(l.id, 'admin').sources[0]!.fresh).toBe(false);
  now += 15000;
  expect(h.status(l.id, 'admin').sources).toEqual([]);
});
it('does not refresh a pose for a mismatched sequence or a different session', () => {
  let now = 100000;
  const h = new ObservationHub(() => now),
    l = h.create('admin', target),
    id = h.source('session', 'owner', 'world', 'village');
  const p = { version: 1 as const, sourceId: id, poseSequence: 1, visible: true, pose };
  h.publish('session', 'owner', 'world', 'village', p);
  now += 10000;
  expect(() => h.publish('other', 'owner', 'world', 'village', p)).toThrow();
  expect(
    h.publish('session', 'owner', 'world', 'village', { ...p, pose: undefined, poseSequence: 2 } as never),
  ).toEqual({ needPose: true });
  expect(h.status(l.id, 'admin').sources[0]!.lastSourceSeenAt).toBe(new Date(100000).toISOString());
});
it('bounds actual poses to five per second separately from a stationary heartbeat', () => {
  const h = new ObservationHub(() => 100000);
  h.create('admin', target);
  const id = h.source('session', 'owner', 'world', 'village');
  for (let i = 1; i <= 5; i++)
    h.publish('session', 'owner', 'world', 'village', {
      version: 1,
      sourceId: id,
      poseSequence: i,
      visible: true,
      pose,
    });
  expect(
    h.publish('session', 'owner', 'world', 'village', { version: 1, sourceId: id, poseSequence: 5, visible: true }),
  ).toEqual({ needPose: false });
  expect(() =>
    h.publish('session', 'owner', 'world', 'village', {
      version: 1,
      sourceId: id,
      poseSequence: 6,
      visible: true,
      pose,
    }),
  ).toThrow();
  const other = new ObservationHub(() => 100000);
  other.create('admin', target);
  const source = other.source('session', 'owner', 'world', 'village');
  for (let i = 1; i <= 5; i++)
    other.publish('session', 'owner', 'world', 'village', {
      version: 1,
      sourceId: source,
      poseSequence: i,
      visible: true,
      pose,
    });
  expect(() =>
    other.publish('session', 'owner', 'world', 'village', {
      version: 1,
      sourceId: source,
      poseSequence: 6,
      visible: true,
      pose,
    }),
  ).toThrow();
});
it('replaces one stream atomically and makes old close callbacks harmless', () => {
  const h = new ObservationHub(),
    l = h.create('admin', target),
    first = h.open(l.id, 'admin'),
    closed = vi.fn(() => first.release());
  expect(first.attach(closed)).toBe(true);
  const next = h.open(l.id, 'admin');
  expect(closed).toHaveBeenCalledOnce();
  first.release();
  const latest = vi.fn();
  expect(next.attach(latest)).toBe(true);
  expect(first.current()).toBe(false);
  h.close(l.id);
  expect(latest).toHaveBeenCalledOnce();
});
it('limits leases, rejects another administrator and erases collection on last close', () => {
  const h = new ObservationHub(),
    l = h.create('admin', target);
  for (let i = 0; i < 3; i++) h.create('admin', target);
  expect(() => h.create('admin', target)).toThrow();
  expect(() => h.get(l.id, 'other')).toThrow();
  const id = h.source('session', 'owner', 'world', 'village');
  h.closeAll();
  expect(() =>
    h.publish('session', 'owner', 'world', 'village', {
      version: 1,
      sourceId: id,
      poseSequence: 1,
      visible: true,
      pose,
    }),
  ).toThrow();
  expect(h.collecting).toBe(false);
});
it('retains partial admission and HTTP failure independently, bounds and isolates feeds', () => {
  const h = new ObservationHub(),
    l = h.create('admin', target),
    other = h.create('other', { ...target, worldId: 'other-world' });
  const action: ObservationAction = {
    id: 'a',
    requestId: 'r',
    worldId: 'world',
    villageId: 'village',
    accountId: 'owner',
    at: new Date().toISOString(),
    kind: 'harvest',
    businessOutcome: 'partial',
    httpOutcome: 'finished',
    statusCode: 500,
    accepted: ['wood:1'],
    refused: [{ key: 'stone:2', reason: 'Refus' }],
  };
  h.record(action);
  expect(h.status(l.id, 'admin').actions[0]).toEqual(action);
  expect(h.status(other.id, 'other').actions).toEqual([]);
  for (let i = 0; i < 501; i++) h.record({ ...action, id: String(i) });
  const s = h.status(l.id, 'admin');
  expect(s.actions).toHaveLength(500);
  expect(s.truncated).toBe(true);
});
it('isolates owners of the same village, including closing an earlier owner lease', () => {
  const h = new ObservationHub(),
    old = h.create('admin', target),
    next = h.create('other', { ...target, accountId: 'next-owner' });
  const oldSource = h.source('old-session', 'owner', 'world', 'village'),
    nextSource = h.source('next-session', 'next-owner', 'world', 'village');
  expect(h.status(old.id, 'admin').sources.map((s) => s.id)).toEqual([oldSource]);
  expect(h.status(next.id, 'other').sources.map((s) => s.id)).toEqual([nextSource]);
  const action = {
    id: 'old-action',
    requestId: 'r',
    worldId: 'world',
    villageId: 'village',
    accountId: 'owner',
    at: new Date().toISOString(),
    kind: 'harvest',
    businessOutcome: 'accepted' as const,
    httpOutcome: 'finished' as const,
  };
  h.record(action);
  expect(h.status(next.id, 'other').actions).toEqual([]);
  h.close(old.id);
  expect(h.status(next.id, 'other').sources.map((s) => s.id)).toEqual([nextSource]);
  expect(() => h.source('old-session', 'owner', 'world', 'village')).toThrow();
});
