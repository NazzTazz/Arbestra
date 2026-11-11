import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { Material } from '@babylonjs/core/Materials/material';
import type { Stone } from './building-plan';

/** Offline only: fill subpixel mortar joints, never an opening or a module join. */
export function simplifyMasonry(stones: readonly Stone[], joint: number): Stone[] {
  const merge = (input: readonly Stone[], vertical: boolean) => {
    const groups = new Map<string, Stone[]>();
    for (const stone of input) {
      const along = stone.axis,
        across = along === 'x' ? 'z' : 'x';
      const key = [
        along,
        stone[across],
        stone.thickness,
        ...(vertical ? [stone[along], stone.length] : [stone.y, stone.height]),
      ]
        .map((value) => (typeof value === 'number' ? value.toFixed(7) : value))
        .join(':');
      const group = groups.get(key) ?? [];
      group.push({ ...stone });
      groups.set(key, group);
    }
    const result: Stone[] = [];
    for (const group of groups.values()) {
      const axis = vertical ? 'y' : group[0]!.axis,
        size = vertical ? 'height' : 'length';
      group.sort((a, b) => a[axis] - b[axis]);
      let previous: Stone | undefined;
      for (const stone of group) {
        const low = stone[axis] - stone[size] / 2;
        const end = previous ? previous[axis] + previous[size] / 2 : -Infinity;
        if (previous && low >= end - 1e-7 && low - end <= joint + 1e-7) {
          const start = previous[axis] - previous[size] / 2,
            high = stone[axis] + stone[size] / 2;
          previous.shade =
            (previous.shade * previous[size] + stone.shade * stone[size]) / (previous[size] + stone[size]);
          previous[axis] = (start + high) / 2;
          previous[size] = high - start;
        } else {
          previous = stone;
          result.push(stone);
        }
      }
    }
    return result;
  };
  return merge(merge(stones, false), true);
}

/** One static campus batch per material. Transforms become relative to its logical root. */
export function batchDistantBuilding(root: Mesh): void {
  const children = root.getChildMeshes(),
    inverse = root.computeWorldMatrix(true).clone().invert();
  const groups = new Map<string, Mesh[]>();
  for (const child of children) {
    if (!(child instanceof Mesh) || !child.getTotalVertices()) continue;
    const key = `${child.material?.uniqueId}:${child.metadata?.buildingAttachment ?? ''}`;
    const group = groups.get(key) ?? [];
    group.push(child);
    groups.set(key, group);
  }
  // Factories may free the materials they own when one of their sub-meshes is
  // disposed (market roof, clock, display): disposing the children below would
  // leave the batches with freed materials, baked and drawn as Babylon's white
  // default (town hall 2, medium and distant variants, 11 November). Each batch
  // takes its own copy, owned by this root; textures stay shared.
  const copies = new Map<Material, Material>();
  for (const group of groups.values()) {
    const first = group[0]!;
    const pieces = group.map((mesh) =>
      VertexData.ExtractFromMesh(mesh, true, true).transform(mesh.computeWorldMatrix(true).multiply(inverse)),
    );
    const mesh = new Mesh(`distant-${first.material?.name ?? 'glass'}`, root.getScene());
    pieces[0]!.merge(pieces.slice(1), true, false, false, true).applyToMesh(mesh);
    mesh.parent = root;
    const original = first.material;
    if (original) {
      let copy = copies.get(original);
      if (!copy) {
        copy = original.clone(original.name) ?? original;
        copies.set(original, copy);
      }
      mesh.material = copy;
    } else mesh.material = null;
    mesh.metadata = { ...first.metadata };
    mesh.isPickable = first.isPickable;
    mesh.receiveShadows = true;
  }
  root.onDisposeObservable.addOnce(() => {
    for (const [original, copy] of copies) if (copy !== original) copy.dispose(false, false);
  });
  // Do not dispose textures: the batch materials still share them.
  for (const child of children) if (!child.isDisposed()) child.dispose(false, false);
}
