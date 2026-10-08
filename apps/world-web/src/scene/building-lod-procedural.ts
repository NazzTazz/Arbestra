import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { TimberThatch } from './timber-thatch';
import { coordinateBuildingLod } from './building-lod';
import { AssetContainer } from '@babylonjs/core/assetContainer';
import type { Scene } from '@babylonjs/core/scene';
import { instantiateBakedBuilding } from './building-assets';

const caches = new WeakMap<Scene, Map<string, AssetContainer[]>>();
/** Static workshops share scene-local templates, just like precompiled houses. */
export function buildCachedProceduralBuildingLod(parent: Mesh, key: string, build: (root: Mesh, lod: 0 | 1 | 2) => void, kit?: TimberThatch) {
  const scene = parent.getScene();
  let cache = caches.get(scene);
  if (!cache) {
    cache = new Map(); caches.set(scene, cache);
    scene.onDisposeObservable.addOnce(() => { for (const containers of cache!.values()) for (const container of containers) container.dispose(); cache!.clear(); });
  }
  let containers = cache.get(key);
  if (!containers) {
    containers = [];
    const previous = kit?.lod;
    try {
      for (const lod of [0, 1, 2] as const) {
        if (kit) kit.lod = lod;
        const root = new Mesh(`${key}-template-lod${lod}`, scene), container = new AssetContainer(scene);
        containers.push(container); container.meshes.push(root);
        build(root, lod);
        container.meshes.push(...root.getChildMeshes().filter((mesh): mesh is Mesh => mesh instanceof Mesh));
        container.removeAllFromScene();
      }
      cache.set(key, containers);
    } catch (error) { for (const container of containers) container.dispose(); throw error; }
    finally { if (kit) kit.lod = previous!; }
  }
  const roots = containers.map(container => instantiateBakedBuilding(container, parent).rootNodes);
  coordinateBuildingLod(parent, roots[0]!, roots[2]!, roots[1]!);
}

/** Exceptional layouts/animated factories: prepare once, never on a zoom transition. */
export function buildProceduralBuildingLod(parent: Mesh, build: (root: Mesh, lod: 0 | 1 | 2) => void, kit?: TimberThatch) {
  const roots: Mesh[] = [], previous = kit?.lod;
  try {
    for (const lod of [0, 1, 2] as const) {
      const root = new Mesh(`${parent.name}-lod${lod}`, parent.getScene()); root.parent = parent;
      roots.push(root);
      if (kit) kit.lod = lod;
      build(root, lod);
    }
    coordinateBuildingLod(parent, [roots[0]!], [roots[2]!], [roots[1]!]);
  } catch (error) {
    for (const root of roots) root.dispose(false, false);
    throw error;
  } finally { if (kit) kit.lod = previous!; }
}
