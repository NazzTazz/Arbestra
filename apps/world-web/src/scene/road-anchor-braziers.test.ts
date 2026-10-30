import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { ClusteredLightContainer } from '@babylonjs/core/Lights/Clustered/clusteredLightContainer';
import { roadAnchorSubPoint, type RoadAnchor } from '@arbestra/contracts';
import { RoadAnchorBraziers, RoadAnchorMarkers } from './road-anchor-braziers';
import { WorldSpace } from './world-space';

beforeEach(() => {
  vi.stubGlobal(
    'OffscreenCanvas',
    class {
      constructor(
        public width: number,
        public height: number,
      ) {}
      getContext() {
        return { putImageData() {} };
      }
    },
  );
  vi.stubGlobal(
    'ImageData',
    class {
      data: Uint8ClampedArray;
      constructor(width: number, height: number) {
        this.data = new Uint8ClampedArray(width * height * 4);
      }
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

const world = { widthCells: 128, heightCells: 128 };
const cell = (cellX: number, cellY: number) => ({ cellX, cellY });
/** A comb of `teeth` T junctions: a horizontal road on row 10 with one-cell teeth on row 11. */
function comb(teeth: number) {
  const cells = [];
  for (let x = 0; x < teeth * 2 + 1; x++) cells.push(cell(x, 10));
  for (let t = 0; t < teeth; t++) cells.push(cell(t * 2 + 1, 11));
  return cells;
}
const row = (vertexX: number, vertexY: number, accessory: RoadAnchor['accessory'], revision = 1): RoadAnchor => ({
  id: `${vertexX},${vertexY}`,
  vertexX,
  vertexY,
  accessory,
  revision,
});

it('creates or disposes only the fires of the anchors a command changed', () => {
  const engine = new NullEngine(),
    scene = new Scene(engine),
    braziers = new RoadAnchorBraziers(scene),
    space = new WorldSpace(world.widthCells, world.heightCells, cell(0, 0));
  const flat = () => 1;
  try {
    // 40 teeth: two re-entrant corners each, 80 automatic braziers.
    const cells = comb(40);
    expect(braziers.update(cells, undefined, space, flat, undefined, 'g1')).toBe(80);
    // Same inputs: nothing to do.
    expect(braziers.update(cells, undefined, space, flat, undefined, 'g1')).toBe(0);
    // A manual brazier: one fire created, whatever the village size.
    let stored = [row(0, 10, 'brazier')];
    expect(braziers.update([...cells], stored, space, flat, undefined, 'g1')).toBe(1);
    // An automatic brazier removed (stored `none`): one fire disposed.
    stored = [...stored, row(1, 11, 'none')];
    expect(braziers.update([...cells], stored, space, flat, undefined, 'g1')).toBe(1);
    // Restored: one fire created again.
    stored = stored.slice(0, 1);
    expect(braziers.update([...cells], stored, space, flat, undefined, 'g1')).toBe(1);
    expect(braziers.fires.stats).toEqual({ created: 82, removed: 1 });
    // New ground heights move the existing fires; none is rebuilt.
    expect(braziers.update([...cells], stored, space, () => 2, undefined, 'g2')).toBe(0);
    expect(braziers.fires.stats).toEqual({ created: 82, removed: 1 });
    // Unknown ground: not drawn yet, drawn once published.
    const fresh = new RoadAnchorBraziers(scene);
    expect(fresh.update(cells, undefined, space, () => null, undefined, 'g0')).toBe(0);
    expect(fresh.update(cells, undefined, space, flat, undefined, 'g1')).toBe(80);
    fresh.dispose();
  } finally {
    braziers.dispose();
    scene.dispose();
    engine.dispose();
  }
});

it('does not draw an anchor brazier where a legacy fire stands', () => {
  const engine = new NullEngine(),
    scene = new Scene(engine),
    braziers = new RoadAnchorBraziers(scene),
    space = new WorldSpace(world.widthCells, world.heightCells, cell(0, 0));
  try {
    const cells = comb(2);
    const corner = roadAnchorSubPoint({ vertexX: 1, vertexY: 11 }, world);
    // One eighth off: still the same visible place.
    const legacy = new Set([`${corner.x + 1}:${corner.y}`]);
    expect(braziers.update(cells, undefined, space, () => 0, legacy, 'g')).toBe(3);
    expect(braziers.hiddenByLegacy).toBe(1);
  } finally {
    braziers.dispose();
    scene.dispose();
    engine.dispose();
  }
});

it('rewrites the bounded marker set and emphasizes the snapped anchor', () => {
  const engine = new NullEngine();
  // NullEngine reports no instanced arrays, which disables thin instances.
  (engine.getCaps() as { instancedArrays: boolean }).instancedArrays = true;
  const scene = new Scene(engine),
    markers = new RoadAnchorMarkers(scene);
  try {
    const points = Array.from({ length: 12 }, (_, i) => ({ x: i, y: 0, z: 0 }));
    markers.set(points, 0.5, false, { x: 3, y: 0, z: 0 });
    const mesh = scene.getMeshByName('road-anchor-markers') as Mesh;
    expect(markers.count).toBe(13);
    const matrices = mesh.thinInstanceGetWorldMatrices();
    expect(matrices[0]!.m[0]).toBeCloseTo(0.5);
    expect(matrices[12]!.m[0]).toBeCloseTo(0.9);
    markers.set(points.slice(0, 2), 0.5, true);
    expect(markers.count).toBe(2);
    markers.clear();
    expect(markers.count).toBe(0);
    expect(mesh.isEnabled()).toBe(false);
  } finally {
    markers.dispose();
    scene.dispose();
    engine.dispose();
  }
});

it('takes a removed fire out of the light cluster without handing its light back to the scene', () => {
  const engine = new NullEngine(),
    scene = new Scene(engine);
  // A clustering engine, as in the browser (village-braziers.test).
  Object.assign(engine.getCaps(), {
    texelFetch: true,
    colorBufferFloat: true,
    blendFloat: true,
    shaderFloatPrecision: 23,
  });
  Object.defineProperty(engine, 'version', { value: 2 });
  const receivers = Array.from({ length: 50 }, (_, i) => MeshBuilder.CreateBox(`receiver-${i}`, {}, scene));
  const braziers = new RoadAnchorBraziers(scene),
    space = new WorldSpace(world.widthCells, world.heightCells, cell(0, 0));
  try {
    const cells = comb(3);
    expect(braziers.update(cells, undefined, space, () => 0, undefined, 'g')).toBe(6);
    const cluster = scene.lights.find((light) => light instanceof ClusteredLightContainer) as ClusteredLightContainer;
    expect(cluster.lights).toHaveLength(6);
    const add = vi.spyOn(scene, 'addLight');
    const sources = vi.spyOn(receivers[0]!, '_removeLightSource');
    expect(braziers.update(cells, [row(1, 11, 'none')], space, () => 0, undefined, 'g')).toBe(1);
    expect(add).not.toHaveBeenCalled();
    expect(cluster.lights).toHaveLength(5);
    // The disposed light never became a light source of the meshes.
    expect(receivers.every((mesh) => mesh.lightSources.every((light) => !(light instanceof PointLight)))).toBe(true);
    expect(sources).toHaveBeenCalledTimes(1);
  } finally {
    braziers.dispose();
    scene.dispose();
    engine.dispose();
  }
});
