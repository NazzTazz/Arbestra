import { expect, it } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { AssetContainer } from '@babylonjs/core/assetContainer';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Camera } from '@babylonjs/core/Cameras/camera';
import { Ray } from '@babylonjs/core/Culling/ray';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { instantiateBakedBuilding } from './building-assets';
import { coordinateBuildingLod, nextBuildingLod, projectedDiameter } from './building-lod';
import {
  buildingLodRenderHeight,
  DEFAULT_BUILDING_LOD,
  setBuildingLodReferenceScaling,
  setBuildingLodSettings,
  validBuildingLod,
} from './building-lod-settings';
import { buildCachedProceduralBuildingLod } from './building-lod-procedural';

it('uses the projected size: focal length, render resolution, viewport and orthographic zoom', () => {
  expect(projectedDiameter(10, 100, 4, 750)).toBe(300);
  expect(projectedDiameter(10, 100, 8, 750)).toBe(600);
  expect(projectedDiameter(10, 100, 4, 375)).toBe(150);
  expect(projectedDiameter(10, 100, 0.1, 750, true)).toBe(750);
  expect(projectedDiameter(10, 0, 4, 750)).toBe(Infinity);
});

it('coordinates three cached levels, adjusts thresholds without rebuilding and rejects inverted settings', () => {
  const engine = new NullEngine({
    renderWidth: 1200,
    renderHeight: 750,
    textureSize: 512,
    deterministicLockstep: false,
    lockstepMaxSteps: 4,
  });
  const scene = new Scene(engine),
    camera = new FreeCamera('camera', new Vector3(0, 0, -10), scene);
  let builds = 0;
  const create = (id: string, size = 2) => {
    const root = new Mesh(id, scene);
    root.metadata = { siteId: id };
    buildCachedProceduralBuildingLod(root, `box-${size}`, (variant, level) => {
      builds++;
      const wall = MeshBuilder.CreateBox(`quality-${level}`, { size }, scene);
      wall.parent = variant;
    });
    return root;
  };
  try {
    const a = create('a'),
      b = create('b'),
      large = create('large', 6);
    b.position.x = 10;
    large.position.x = 20;
    expect(builds).toBe(6);
    const update = (z: number) => {
      camera.position.z = z;
      scene.render();
    };
    const only = (root: Mesh, level: string) => {
      expect(root.metadata.buildingLod.active).toBe(level);
      expect(root.getChildMeshes().filter((m) => m.getTotalVertices() && m.isEnabled())).toHaveLength(1);
    };
    for (let cycle = 0; cycle < 4; cycle++) {
      update(-10);
      only(a, 'detailed');
      update(-25);
      only(a, 'peripheral');
      only(large, 'peripheral');
      update(-45);
      only(a, 'distant');
    }
    a.scaling.setAll(2);
    update(-45);
    only(a, 'peripheral');
    a.scaling.setAll(3);
    update(-45);
    only(a, 'detailed');
    a.scaling.setAll(1);
    expect(setBuildingLodSettings({ near: 18, far: 10 })).toBe(true);
    scene.render();
    only(a, 'detailed');
    expect(builds).toBe(6);
    expect(validBuildingLod({ near: 10, far: 20 })).toBe(false);
    expect(setBuildingLodSettings({ near: NaN, far: 10 })).toBe(false);
    const source = a.getChildMeshes().find((m) => m instanceof InstancedMesh) as InstancedMesh;
    a.dispose(false, false);
    expect(source.sourceMesh.isDisposed()).toBe(false);
    const replacement = create('a');
    expect(builds).toBe(6);
    replacement.dispose(false, false);
    scene.dispose();
    expect(source.sourceMesh.isDisposed()).toBe(true);
  } finally {
    setBuildingLodSettings({ ...DEFAULT_BUILDING_LOD });
    scene.dispose();
    engine.dispose();
  }
});

it.each([false, true])(
  'switches the whole instanced recipe, preserving picking, identity, origin shifts and shared sources (frozen: %s)',
  async (frozen) => {
    const { freezeStaticHierarchy, refreshStaticHierarchy } = await import('./static-transforms');
    const engine = new NullEngine({
      renderWidth: 1200,
      renderHeight: 750,
      textureSize: 512,
      deterministicLockstep: false,
      lockstepMaxSteps: 4,
    });
    const scene = new Scene(engine),
      camera = new FreeCamera('camera', new Vector3(0, 0, -20), scene);
    const containers: AssetContainer[] = [];
    const makeContainer = (name: string) => {
      const container = new AssetContainer(scene),
        root = new Mesh(name, scene);
      for (const x of [-2, 2]) {
        const wall = MeshBuilder.CreateBox(`${name}-wall-${x}`, { size: 2 }, scene);
        wall.parent = root;
        wall.position.x = x;
        container.meshes.push(wall);
      }
      container.meshes.push(root);
      container.removeAllFromScene();
      containers.push(container);
      return container;
    };
    try {
      const detail = makeContainer('detail'),
        coarse = makeContainer('coarse'),
        baseline = scene.onBeforeActiveMeshesEvaluationObservable.observers.length;
      const makeBuilding = (id: string, x: number) => {
        const root = new Mesh(id, scene);
        root.metadata = { siteId: id };
        root.position.x = x;
        const a = instantiateBakedBuilding(detail, root),
          b = instantiateBakedBuilding(coarse, root);
        coordinateBuildingLod(root, a.rootNodes, b.rootNodes);
        if (frozen) freezeStaticHierarchy(root);
        return root;
      };
      const a = makeBuilding('site-a', 0),
        b = makeBuilding('site-b', 12);
      const sources = scene.meshes.filter((m) => m instanceof Mesh && m.instances.length);
      const pick = (x: number) =>
        scene.pickWithRay(
          new Ray(new Vector3(x, 0, camera.position.z), Vector3.Forward()),
          (mesh) => mesh.isEnabled() && mesh.isVisible && mesh.isPickable && typeof mesh.metadata?.siteId === 'string',
        )?.pickedMesh;
      const evaluate = (z: number) => {
        camera.position.z = z;
        camera.getViewMatrix(true);
        camera.getProjectionMatrix(true);
        scene.render();
      };
      evaluate(-10);
      expect(a.metadata.buildingLod.active).toBe('detailed');
      expect(pick(-2)?.metadata.siteId).toBe('site-a');
      expect(pick(-2)?.name).toContain('detail');
      for (let cycle = 0; cycle < 6; cycle++) {
        evaluate(-100);
        expect(a.metadata.buildingLod.active).toBe('distant');
        expect(pick(-2)?.name).toContain('coarse');
        expect(pick(10)?.metadata.siteId).toBe('site-b');
        expect(a.getChildMeshes().filter((m) => m.getTotalVertices() && m.isEnabled())).toHaveLength(2);
        expect(
          a
            .getChildMeshes()
            .filter((m) => m.getTotalVertices())
            .every((m) => m instanceof InstancedMesh),
        ).toBe(true);
        evaluate(-10);
      }
      evaluate(-100);
      const diameter = a.metadata.buildingLod.diameter;
      a.rotation.y = Math.PI / 2;
      refreshStaticHierarchy(a);
      scene.render();
      expect(a.metadata.buildingLod.diameter).toBeCloseTo(diameter);
      a.position.x -= 1000;
      b.position.x -= 1000;
      camera.position.x -= 1000;
      refreshStaticHierarchy(a);
      refreshStaticHierarchy(b);
      scene.render();
      expect(a.metadata.buildingLod.diameter).toBeCloseTo(diameter);
      camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
      camera.orthoLeft = -10;
      camera.orthoRight = 10;
      camera.orthoTop = 6;
      camera.orthoBottom = -6;
      scene.render();
      expect(a.metadata.buildingLod.active).toBe('detailed');
      a.dispose(false, false);
      b.dispose(false, false);
      expect(sources.every((m) => !m.isDisposed())).toBe(true);
      expect(
        scene.onBeforeActiveMeshesEvaluationObservable.observers.filter((o) => !o._willBeUnregistered),
      ).toHaveLength(baseline);
      const replacement = makeBuilding('site-a', 0);
      expect(replacement.metadata.siteId).toBe('site-a');
      replacement.dispose(false, false);
    } finally {
      scene.dispose();
      for (const container of containers) container.dispose();
      engine.dispose();
    }
  },
);

it('keeps its variant around a threshold and evaluates every building from one observer', () => {
  // 282 switches a minute without rebasing (11 November): a building whose
  // size sat on a threshold switched at every small zoom or turn.
  const engine = new NullEngine({
    renderWidth: 1200,
    renderHeight: 750,
    textureSize: 512,
    deterministicLockstep: false,
    lockstepMaxSteps: 4,
  });
  const scene = new Scene(engine),
    camera = new FreeCamera('camera', new Vector3(0, 0, -10), scene);
  const baseline = scene.onBeforeActiveMeshesEvaluationObservable.observers.length;
  const create = (id: string, x: number) => {
    const root = new Mesh(id, scene);
    root.position.x = x;
    buildCachedProceduralBuildingLod(root, 'box-hysteresis', (variant, level) => {
      MeshBuilder.CreateBox(`quality-${level}`, { size: 2 }, scene).parent = variant;
    });
    return root;
  };
  try {
    const buildings = [create('a', 0), create('b', 0.001), create('c', -0.001)];
    expect(scene.onBeforeActiveMeshesEvaluationObservable.observers.length).toBe(baseline + 1);
    const at = (z: number) => {
      camera.position.z = z;
      scene.render();
      return buildings[0]!.metadata.buildingLod;
    };
    expect(at(-10).active).toBe('detailed');
    // Just around the near threshold (45 px/m), a 2 % zoom either side.
    const near = DEFAULT_BUILDING_LOD.near;
    const depth = (at(-10).pixelsPerMetre * 10) / near;
    let switches = 0,
      previous = 'detailed';
    for (let i = 0; i < 20; i++) {
      const state = at(-depth * (i % 2 ? 1.02 : 0.98));
      expect(Math.abs(state.pixelsPerMetre / near - 1)).toBeLessThan(0.03);
      if (state.active !== previous) switches++;
      previous = state.active;
    }
    expect(switches).toBe(0);
    // Past the margin it does switch, and back only past the margin above.
    expect(at(-depth * 1.15).active).toBe('peripheral');
    expect(at(-depth * 0.98).active).toBe('peripheral');
    expect(at(-depth * 0.88).active).toBe('detailed');
    expect(buildings.every((b) => b.metadata.buildingLod.active === 'detailed')).toBe(true);
    for (const building of buildings) building.dispose(false, false);
    expect(scene.onBeforeActiveMeshesEvaluationObservable.observers.filter((o) => !o._willBeUnregistered)).toHaveLength(
      baseline,
    );
  } finally {
    scene.dispose();
    engine.dispose();
  }
});

it('applies the margin in both directions and between every pair of levels', () => {
  const settings = { near: 45, far: 28 };
  expect(nextBuildingLod('detailed', 44, settings, true)).toBe('detailed');
  expect(nextBuildingLod('detailed', 40, settings, true)).toBe('peripheral');
  expect(nextBuildingLod('detailed', 10, settings, true)).toBe('distant');
  expect(nextBuildingLod('peripheral', 47, settings, true)).toBe('peripheral');
  expect(nextBuildingLod('peripheral', 50, settings, true)).toBe('detailed');
  expect(nextBuildingLod('peripheral', 27, settings, true)).toBe('peripheral');
  expect(nextBuildingLod('peripheral', 25, settings, true)).toBe('distant');
  expect(nextBuildingLod('distant', 30, settings, true)).toBe('distant');
  expect(nextBuildingLod('distant', 31, settings, true)).toBe('peripheral');
  expect(nextBuildingLod('distant', 47, settings, false)).toBe('distant');
  expect(nextBuildingLod('distant', 50, settings, false)).toBe('detailed');
  expect(nextBuildingLod('detailed', 30, settings, false)).toBe('distant');
});

it('keeps the resting LOD choice while motion lowers the resolution (rendering P2)', () => {
  // Without a reference, the live render height, as before P2.
  setBuildingLodReferenceScaling(null);
  expect(buildingLodRenderHeight(750, 1.2)).toBe(750);
  // Referenced at rest (1.2): at 1.5 in motion the engine renders 600 rows,
  // the LOD still measures the 750 rows of rest, so no building switches.
  setBuildingLodReferenceScaling(1.2);
  try {
    expect(buildingLodRenderHeight(750, 1.2)).toBeCloseTo(750, 9);
    expect(buildingLodRenderHeight(600, 1.5)).toBeCloseTo(750, 9);
  } finally {
    setBuildingLodReferenceScaling(null);
  }
});
