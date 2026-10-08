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
import { coordinateBuildingLod, projectedDiameter } from './building-lod';
import { DEFAULT_BUILDING_LOD, setBuildingLodSettings, validBuildingLod } from './building-lod-settings';
import { buildCachedProceduralBuildingLod } from './building-lod-procedural';

it('uses the projected size: focal length, render resolution, viewport and orthographic zoom', () => {
  expect(projectedDiameter(10, 100, 4, 750)).toBe(300);
  expect(projectedDiameter(10, 100, 8, 750)).toBe(600);
  expect(projectedDiameter(10, 100, 4, 375)).toBe(150);
  expect(projectedDiameter(10, 100, .1, 750, true)).toBe(750);
  expect(projectedDiameter(10, 0, 4, 750)).toBe(Infinity);
});

it('coordinates three cached levels, adjusts thresholds without rebuilding and rejects inverted settings', () => {
  const engine = new NullEngine({ renderWidth: 1200, renderHeight: 750, textureSize: 512, deterministicLockstep: false, lockstepMaxSteps: 4 });
  const scene = new Scene(engine), camera = new FreeCamera('camera', new Vector3(0, 0, -10), scene);
  let builds = 0;
  const create = (id: string, size = 2) => {
    const root = new Mesh(id, scene); root.metadata = { siteId: id };
    buildCachedProceduralBuildingLod(root, `box-${size}`, (variant, level) => {
      builds++; const wall = MeshBuilder.CreateBox(`quality-${level}`, {size}, scene); wall.parent = variant;
    }); return root;
  };
  try {
    const a = create('a'), b = create('b'), large = create('large', 6); b.position.x = 10; large.position.x = 20;
    expect(builds).toBe(6);
    const update = (z: number) => { camera.position.z = z; scene.render(); };
    const only = (root: Mesh, level: string) => {
      expect(root.metadata.buildingLod.active).toBe(level);
      expect(root.getChildMeshes().filter(m => m.getTotalVertices() && m.isEnabled())).toHaveLength(1);
    };
    for (let cycle = 0; cycle < 4; cycle++) {
      update(-10); only(a, 'detailed');
      update(-25); only(a, 'peripheral'); only(large, 'peripheral');
      update(-45); only(a, 'distant');
    }
    a.scaling.setAll(2); update(-45); only(a, 'peripheral');
    a.scaling.setAll(3); update(-45); only(a, 'detailed');
    a.scaling.setAll(1);
    expect(setBuildingLodSettings({near: 18, far: 10})).toBe(true);
    scene.render(); only(a, 'detailed'); expect(builds).toBe(6);
    expect(validBuildingLod({near: 10, far: 20})).toBe(false);
    expect(setBuildingLodSettings({near: NaN, far: 10})).toBe(false);
    const source = a.getChildMeshes().find(m => m instanceof InstancedMesh) as InstancedMesh;
    a.dispose(false, false); expect(source.sourceMesh.isDisposed()).toBe(false);
    const replacement = create('a'); expect(builds).toBe(6); replacement.dispose(false, false);
    scene.dispose(); expect(source.sourceMesh.isDisposed()).toBe(true);
  } finally { setBuildingLodSettings({...DEFAULT_BUILDING_LOD}); scene.dispose(); engine.dispose(); }
});

it('switches the whole instanced recipe, preserving picking, identity, origin shifts and shared sources', () => {
  const engine = new NullEngine({ renderWidth: 1200, renderHeight: 750, textureSize: 512, deterministicLockstep: false, lockstepMaxSteps: 4 });
  const scene = new Scene(engine), camera = new FreeCamera('camera', new Vector3(0, 0, -20), scene);
  const containers: AssetContainer[] = [];
  const makeContainer = (name: string) => {
    const container = new AssetContainer(scene), root = new Mesh(name, scene);
    for (const x of [-2, 2]) { const wall = MeshBuilder.CreateBox(`${name}-wall-${x}`, { size: 2 }, scene); wall.parent = root; wall.position.x = x; container.meshes.push(wall); }
    container.meshes.push(root); container.removeAllFromScene(); containers.push(container); return container;
  };
  try {
    const detail = makeContainer('detail'), coarse = makeContainer('coarse'), baseline = scene.onBeforeActiveMeshesEvaluationObservable.observers.length;
    const makeBuilding = (id: string, x: number) => {
      const root = new Mesh(id, scene); root.metadata = { siteId: id }; root.position.x = x;
      const a = instantiateBakedBuilding(detail, root), b = instantiateBakedBuilding(coarse, root);
      coordinateBuildingLod(root, a.rootNodes, b.rootNodes); return root;
    };
    const a = makeBuilding('site-a', 0), b = makeBuilding('site-b', 12);
    const sources = scene.meshes.filter(m => m instanceof Mesh && m.instances.length);
    const pick = (x: number) => scene.pickWithRay(new Ray(new Vector3(x, 0, camera.position.z), Vector3.Forward()),
      mesh => mesh.isEnabled() && mesh.isVisible && mesh.isPickable && typeof mesh.metadata?.siteId === 'string')?.pickedMesh;
    const evaluate = (z: number) => { camera.position.z = z; camera.getViewMatrix(true); camera.getProjectionMatrix(true); scene.render(); };
    evaluate(-10);
    expect(a.metadata.buildingLod.active).toBe('detailed');
    expect(pick(-2)?.metadata.siteId).toBe('site-a');
    expect(pick(-2)?.name).toContain('detail');
    for (let cycle = 0; cycle < 6; cycle++) {
      evaluate(-100);
      expect(a.metadata.buildingLod.active).toBe('distant');
      expect(pick(-2)?.name).toContain('coarse'); expect(pick(10)?.metadata.siteId).toBe('site-b');
      expect(a.getChildMeshes().filter(m => m.getTotalVertices() && m.isEnabled())).toHaveLength(2);
      expect(a.getChildMeshes().filter(m => m.getTotalVertices()).every(m => m instanceof InstancedMesh)).toBe(true);
      evaluate(-10);
    }
    evaluate(-100); const diameter = a.metadata.buildingLod.diameter;
    a.rotation.y = Math.PI / 2; scene.render(); expect(a.metadata.buildingLod.diameter).toBeCloseTo(diameter);
    a.position.x -= 1000; b.position.x -= 1000; camera.position.x -= 1000;
    scene.render(); expect(a.metadata.buildingLod.diameter).toBeCloseTo(diameter);
    camera.mode = Camera.ORTHOGRAPHIC_CAMERA; camera.orthoLeft = -10; camera.orthoRight = 10; camera.orthoTop = 6; camera.orthoBottom = -6;
    scene.render(); expect(a.metadata.buildingLod.active).toBe('detailed');
    a.dispose(false, false); b.dispose(false, false);
    expect(sources.every(m => !m.isDisposed())).toBe(true);
    expect(scene.onBeforeActiveMeshesEvaluationObservable.observers.filter(o => !o._willBeUnregistered)).toHaveLength(baseline);
    const replacement = makeBuilding('site-a', 0); expect(replacement.metadata.siteId).toBe('site-a'); replacement.dispose(false, false);
  } finally { scene.dispose(); for (const container of containers) container.dispose(); engine.dispose(); }
});
