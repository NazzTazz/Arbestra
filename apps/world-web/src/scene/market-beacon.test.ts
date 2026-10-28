import { afterEach, describe, expect, it, vi } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { Material } from '@babylonjs/core/Materials/material';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Light } from '@babylonjs/core/Lights/light';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { ClusteredLightContainer } from '@babylonjs/core/Lights/Clustered/clusteredLightContainer';
import { beaconLevel, extendBeacon, MARKET_BEACON, MarketBeacon } from './market-beacon';
import { VillageBraziers } from './village-braziers';

const end = (deliveries = 1) =>
  MARKET_BEACON.riseMs +
  MARKET_BEACON.holdMs +
  Math.min(deliveries - 1, MARKET_BEACON.maxExtraHolds) * MARKET_BEACON.extraHoldMs +
  MARKET_BEACON.fallMs;

function stubCanvas() {
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
}
/** A null engine that reports the capabilities clustered lights need (as the brazier tests do). */
function clusteredScene() {
  const engine = new NullEngine(),
    scene = new Scene(engine);
  Object.assign(engine.getCaps(), {
    texelFetch: true,
    colorBufferFloat: true,
    blendFloat: true,
    shaderFloatPrecision: 23,
  });
  Object.defineProperty(engine, 'version', { value: 2 });
  return { engine, scene };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('market beacon timing', () => {
  it('rises quickly, holds, then fades out in about two seconds', () => {
    const timing = extendBeacon(null, 0, 1);
    expect(end()).toBeGreaterThanOrEqual(1800);
    expect(end()).toBeLessThanOrEqual(2000);
    expect(beaconLevel(timing, 0)).toBe(0);
    expect(beaconLevel(timing, MARKET_BEACON.riseMs)).toBe(1);
    expect(beaconLevel(timing, MARKET_BEACON.riseMs + MARKET_BEACON.holdMs - 1)).toBe(1);
    expect(beaconLevel(timing, end() - 1)).toBeGreaterThan(0);
    expect(beaconLevel(timing, end())).toBeNull();
  });

  it('prolongs one column for grouped or successive deliveries, without dimming it', () => {
    expect(beaconLevel(extendBeacon(null, 0, 3), end(3) - 1)).toBeGreaterThan(0);
    expect(beaconLevel(extendBeacon(null, 0, 3), end(3))).toBeNull();
    // More deliveries than the cap hold no longer than the cap.
    expect(beaconLevel(extendBeacon(null, 0, 50), end(50))).toBeNull();
    const first = extendBeacon(null, 0, 1),
      fading = end() - 300,
      before = beaconLevel(first, fading)!;
    const revived = extendBeacon(first, fading, 1);
    expect(beaconLevel(revived, fading)).toBeCloseTo(before, 6);
    expect(beaconLevel(revived, fading + MARKET_BEACON.riseMs)).toBe(1);
    expect(beaconLevel(revived, fading + end() - 1)).toBeGreaterThan(0);
    // A delivery during the hold keeps the rise where it was.
    const held = extendBeacon(first, 500, 1);
    expect(held.riseFrom).toBe(0);
    expect(beaconLevel(held, 500)).toBe(1);
  });
});

describe('market beacon in the scene', () => {
  it('prepares its light in the fire cluster and never adds, toggles or recompiles anything when triggered', () => {
    stubCanvas();
    const { engine, scene } = clusteredScene();
    const receiver = MeshBuilder.CreateGround('receiver', { width: 20, height: 20 }, scene);
    receiver.material = new StandardMaterial('receiver', scene);
    const braziers = new VillageBraziers(scene);
    braziers.updatePoints([{ x: 3, y: 0, z: 0, seed: 0.4 }]);
    braziers.animate(0, true, 1);
    const beacon = new MarketBeacon(scene);
    try {
      const cluster = scene.lights.find((l) => l instanceof ClusteredLightContainer) as ClusteredLightContainer;
      expect(cluster.lights).toContain(beacon.light);
      expect(scene.lights).not.toContain(beacon.light);
      expect(beacon.light!.intensity).toBe(0);
      const lights = scene.lights.length,
        clustered = cluster.lights.length,
        meshes = scene.meshes.length,
        materials = scene.materials.length;
      const added = vi.spyOn(scene, 'addLight'),
        toggled = vi.spyOn(Light.prototype, 'setEnabled'),
        lightDirty = vi.spyOn(Light.prototype, '_markMeshesAsLightDirty'),
        meshLightDirty = vi.spyOn(AbstractMesh.prototype, '_markSubMeshesAsLightDirty'),
        materialDirty = vi.spyOn(Material.prototype, 'markAsDirty'),
        sceneDirty = vi.spyOn(scene, 'markAllMaterialsAsDirty');
      beacon.trigger(1000, 2);
      let peak = 0;
      for (let now = 1000; now <= 1000 + end(2) + 100; now += 16) {
        beacon.update(now, 4, 0.5, -2);
        braziers.animate(now, true, 1);
        peak = Math.max(peak, beacon.light!.intensity);
      }
      expect(peak).toBeCloseTo(MARKET_BEACON.light.intensity, 1);
      expect(beacon.light!.position.asArray()).toEqual([4, 0.5 + MARKET_BEACON.light.height, -2]);
      expect(beacon.light!.intensity).toBe(0);
      expect(beacon.active).toBe(false);
      expect(added).not.toHaveBeenCalled();
      expect(toggled).not.toHaveBeenCalled();
      expect(lightDirty).not.toHaveBeenCalled();
      expect(meshLightDirty).not.toHaveBeenCalled();
      expect(materialDirty).not.toHaveBeenCalled();
      expect(sceneDirty).not.toHaveBeenCalled();
      expect([scene.lights.length, cluster.lights.length, scene.meshes.length, scene.materials.length]).toEqual([
        lights,
        clustered,
        meshes,
        materials,
      ]);
    } finally {
      beacon.dispose();
      braziers.dispose();
      scene.dispose();
      engine.dispose();
    }
  });

  it('compiles at construction the shader variants the effect draws with', () => {
    const engine = new NullEngine(),
      scene = new Scene(engine);
    const compiled: { mesh: string; instances: boolean; stretched: boolean }[] = [];
    vi.spyOn(Material.prototype, 'forceCompilation').mockImplementation(function (this: Material, mesh, done, options) {
      compiled.push({
        mesh: mesh.name,
        instances: Boolean(options?.useInstances),
        stretched: (mesh as Mesh).scaling.y !== 1,
      });
      done?.(this);
    });
    const beacon = new MarketBeacon(scene);
    try {
      // Measured in the browser bench: without them, the first delivery froze two frames (130 and 470 ms).
      expect(compiled).toEqual([
        { mesh: beacon.column.name, instances: false, stretched: true },
        { mesh: beacon.column.name, instances: false, stretched: false },
        { mesh: beacon.particles.name, instances: true, stretched: false },
      ]);
    } finally {
      beacon.dispose();
      scene.dispose();
      engine.dispose();
    }
  });

  it('keeps the shared cluster for the remaining owner, whichever leaves first', () => {
    stubCanvas();
    const { engine, scene } = clusteredScene();
    const containers = () => scene.lights.filter((l) => l instanceof ClusteredLightContainer).length;
    try {
      const beacon = new MarketBeacon(scene),
        braziers = new VillageBraziers(scene);
      braziers.updatePoints([{ x: 0, y: 0, z: 0, seed: 0.2 }]);
      expect(containers()).toBe(1);
      braziers.dispose();
      expect(containers()).toBe(1);
      expect(beacon.light!.isDisposed()).toBe(false);
      beacon.dispose();
      expect(containers()).toBe(0);
      expect(scene.lights.filter((l) => l instanceof PointLight)).toHaveLength(0);
    } finally {
      scene.dispose();
      engine.dispose();
    }
  });

  it('bounds its per-frame work to one column, the sparks and motes, and one light; none at rest', () => {
    const engine = new NullEngine(),
      scene = new Scene(engine);
    const beacon = new MarketBeacon(scene);
    // Without clustered lighting, no light at all rather than a scene light.
    expect(beacon.light).toBeNull();
    expect(scene.lights).toHaveLength(0);
    const uploads = vi.spyOn(Mesh.prototype, 'thinInstanceBufferUpdated');
    try {
      expect(beacon.instanceCount).toBe(MARKET_BEACON.sparks.count + MARKET_BEACON.motes.count);
      expect(beacon.instanceCount).toBeLessThanOrEqual(64);
      for (let now = 0; now < 1000; now += 16) beacon.update(now, 0, 0, 0);
      expect(uploads).not.toHaveBeenCalled();
      expect(beacon.column.isEnabled()).toBe(false);
      expect(beacon.particles.isEnabled()).toBe(false);

      const meshes = scene.meshes.length;
      beacon.trigger(1000);
      let frames = 0;
      for (let now = 1000; beacon.active; now += 16, frames++) {
        beacon.update(now, 0, 0, 0);
        if (beacon.active) {
          expect(beacon.column.isEnabled()).toBe(true);
          expect(beacon.particles.thinInstanceCount).toBe(beacon.instanceCount);
        }
      }
      // Two uploads (matrices, colours) per lit frame; the last frame only hides.
      expect(uploads).toHaveBeenCalledTimes((frames - 1) * 2);
      expect(frames * 16).toBeGreaterThanOrEqual(end());
      expect(beacon.column.isEnabled()).toBe(false);
      expect(beacon.particles.isEnabled()).toBe(false);
      expect(scene.meshes.length).toBe(meshes);
      uploads.mockClear();
      for (let now = 5000; now < 6000; now += 16) beacon.update(now, 0, 0, 0);
      expect(uploads).not.toHaveBeenCalled();
    } finally {
      beacon.dispose();
      scene.dispose();
      engine.dispose();
    }
  });
});
