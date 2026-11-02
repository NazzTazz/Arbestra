import { expect, it } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { HaloMarkerPlugin } from './halo-marker';
import {
  INSPECT_HALO_MS,
  INSPECT_PULSE_MS,
  INSPECT_PULSES,
  InspectHalo,
  inspectHaloOpacity,
  natureFoot,
} from './inspect-halo';
import { WorldSpace } from './world-space';

const world = { widthCells: 64, heightCells: 64 };

it('pulses three times in the rhythm of the other obstacles, dim at the start and the end', () => {
  expect(INSPECT_PULSES).toBe(3);
  expect(INSPECT_PULSE_MS).toBe(1200);
  const samples = Array.from({ length: INSPECT_HALO_MS / 10 + 20 }, (_, i) => inspectHaloOpacity(i * 10));
  let peaks = 0;
  for (let i = 1; i < samples.length - 1; i++)
    if (samples[i]! > samples[i - 1]! && samples[i]! >= samples[i + 1]! && samples[i]! > 0.99) peaks++;
  expect(peaks).toBe(3);
  expect(inspectHaloOpacity(0)).toBe(0);
  expect(inspectHaloOpacity(INSPECT_PULSE_MS / 2)).toBeCloseTo(1, 9);
  expect(inspectHaloOpacity(INSPECT_HALO_MS - 1)).toBeLessThan(1e-4);
  expect(inspectHaloOpacity(INSPECT_HALO_MS)).toBe(0);
});

it('lies at the foot of the tree or rock of the cell nearest to its centre, the centre otherwise', () => {
  const rc1 = {
    trees: [
      { x: 10.3, y: 12.1, elevation: 0, size: 1, crown: 1 },
      { x: 10.1, y: 11.9, elevation: 0, size: 1, crown: 1 },
      { x: 11.2, y: 12, elevation: 0, size: 1, crown: 1 },
    ],
    rocks: [{ x: 63.7, y: 0.2, elevation: 0, width: 1, depth: 1, height: 1, rotation: 0 }],
  };
  const foot = natureFoot({ cellX: 10, cellY: 12 }, [{ rc1 }], world);
  expect(foot.cellX).toBeCloseTo(10.1, 9);
  expect(foot.cellY).toBeCloseTo(11.9, 9);
  // A rock across the seam of the torus belongs to cell (0, 0).
  const seam = natureFoot({ cellX: 0, cellY: 0 }, [{ rc1 }], world);
  expect(seam.cellX).toBeCloseTo(-0.3, 9);
  expect(natureFoot({ cellX: 40, cellY: 40 }, [{ rc1 }, {}], world)).toEqual({ cellX: 40, cellY: 40 });
});

it('creates one ring at the inspection, reads its pulse at bind time, and releases it after the last pulse', () => {
  const engine = new NullEngine(),
    scene = new Scene(engine);
  let now = 1000;
  const timers = new Map<number, { at: number; callback: () => void }>();
  let next = 1;
  const halo = new InspectHalo(scene, {
    now: () => now,
    setTimeout: (callback, ms) => {
      timers.set(next, { at: now + ms, callback });
      return next++;
    },
    clearTimeout: (id) => timers.delete(id),
  });
  const ground = { ground: (x: number, y: number) => ({ height: 2 + x * 0.01 + y * 0.01 }) } as never;
  const space = new WorldSpace(64, 64, { cellX: 30, cellY: 30 });
  const meshes = scene.meshes.length,
    materials = scene.materials.length;
  expect(halo.show({ cellX: 31.2, cellY: 30.9 }, ground, space)).toBe(true);
  expect(halo.active).toBe(true);
  expect(scene.meshes.length).toBe(meshes + 1);
  expect(scene.materials.length).toBe(materials + 1);
  const mesh = scene.meshes.at(-1)!;
  expect(mesh.position.x).toBeCloseTo(1.2 * 2.5, 9);
  const plugin = (mesh.material as StandardMaterial).pluginManager!.getPlugin<HaloMarkerPlugin>('HaloMarker')!;
  // The marker « Onde » at rest, in red; the pulse is its opacity.
  expect(plugin.uniforms().state).toEqual([0, 0, 0]);
  now += INSPECT_PULSE_MS / 2;
  expect(plugin.uniforms().clock[1]).toBeCloseTo(1, 9);
  // One timer: the release after the third pulse.
  expect([...timers.values()].map((t) => t.at)).toEqual([1000 + INSPECT_HALO_MS]);
  now = 1000 + INSPECT_HALO_MS;
  for (const t of [...timers.values()]) t.callback();
  expect(halo.active).toBe(false);
  expect(scene.meshes.length).toBe(meshes);
  expect(scene.materials.length).toBe(materials);
  // A new inspection replaces the ring; no ground there: nothing laid.
  expect(halo.show({ cellX: 31, cellY: 31 }, ground, space)).toBe(true);
  expect(halo.show({ cellX: 31, cellY: 31 }, { ground: () => null } as never, space)).toBe(false);
  expect(scene.meshes.length).toBe(meshes);
  expect(timers.size).toBe(0);
  scene.dispose();
  engine.dispose();
});
