import type { Ray } from '@babylonjs/core/Culling/ray.core';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { NaturalFeature } from '@arbestra/contracts';
import { cellKey, type Cell } from './construction-selection';
import type { ResourceHaloCell } from './resource-halos';
import { groveHalos, type TreeHaloGrove, type WoodOffer } from './tree-halos';
import { delta } from './world-space';

/** Cell halos (gardens, stone) nearest the camera target. */
export const RESOURCE_OVERLAY_CELL_CAP = 128;
/** Tree halos: whole groves nearest the camera target, until this many trees are placed. */
export const RESOURCE_OVERLAY_TREE_CAP = 1200;

export interface ResourceOverlayInput {
  /** Garden plot keys ready to harvest. */
  gardens: Iterable<string>;
  /** Features of the chunks in view. */
  features: Iterable<NaturalFeature>;
  /** Whether the cell's terrain is on screen with known ground (rendered, land). */
  shown: (cell: Cell) => boolean;
  /** Camera target: nearer halos win when the caps bite. */
  target: Cell;
  world: { widthCells: number; heightCells: number; chunkSize: number };
  cellCap?: number;
  treeCap?: number;
  /** The wood tool's mode and queue: which trees are offered (tree-halos.ts). */
  wood?: WoodOffer;
}

/**
 * What the Exploitation overlay offers: a halo per cell for gardens and stone,
 * a halo per tree on offer for wood (one entry each, so that a tree is
 * validated and queued on its own). Groves are kept whole and taken nearest
 * first, so the budget never leaves a hole in the middle of the screen.
 */
export function resourceOverlay(input: ResourceOverlayInput): { cells: ResourceHaloCell[]; groves: TreeHaloGrove[] } {
  const { world, target } = input;
  const distance = (cell: Cell) =>
    Math.abs(delta(cell.cellX, target.cellX, world.widthCells)) +
    Math.abs(delta(cell.cellY, target.cellY, world.heightCells));
  const cells = new Map<string, ResourceHaloCell>();
  for (const key of input.gardens) {
    const [cellX, cellY] = key.split(':').map(Number);
    cells.set(key, { cellX: cellX!, cellY: cellY!, garden: true, resource: 'carrot' });
  }
  const groves = new Map<string, { at: Cell; halos: TreeHaloGrove[] }>();
  for (const f of input.features) {
    if (!f.deposit || f.deposit.cleared) continue;
    if (f.deposit.resourceCode === 'wood') {
      // Clearing offers stumps too: a case without wood left may still be cleared.
      if (groves.has(f.id) || !input.shown(f)) continue;
      const halos = groveHalos(f, world.chunkSize, input.wood);
      if (halos.length) groves.set(f.id, { at: f, halos });
    } else if (f.deposit.availableAmount > 0) cells.set(cellKey(f), { ...f, resource: f.deposit.resourceCode });
  }
  const visibleCells = [...cells.values()]
    .filter((c) => input.shown(c))
    .sort((a, b) => distance(a) - distance(b))
    .slice(0, input.cellCap ?? RESOURCE_OVERLAY_CELL_CAP);
  const visibleGroves: TreeHaloGrove[] = [];
  let trees = 0;
  for (const grove of [...groves.values()].sort((a, b) => distance(a.at) - distance(b.at))) {
    if (visibleGroves.length && trees + grove.halos.length > (input.treeCap ?? RESOURCE_OVERLAY_TREE_CAP)) break;
    visibleGroves.push(...grove.halos);
    trees += grove.halos.length;
  }
  return { cells: visibleCells, groves: visibleGroves };
}

/**
 * Pick predicate for woodland thin instances: Babylon tests every instance's
 * triangles once the grove's box is hit, so trees whose crown lies away from
 * the ray are rejected first by a point-to-ray distance. `reach` covers a tree
 * of height scale 1.3 around its crown centre.
 */
export function groveRayPredicate(ray: Ray, reach = 2.6): (mesh: AbstractMesh, thinInstanceIndex: number) => boolean {
  const point = new Vector3(),
    toPoint = new Vector3(),
    cross = new Vector3();
  return (mesh, index) => {
    if (!Array.isArray(mesh.metadata?.instanceFeatureIds)) return false;
    if (index < 0) return mesh.isEnabled() && mesh.isVisible && mesh.isPickable;
    const m = (mesh as Mesh).thinInstanceGetWorldMatrices()[index]?.m;
    if (!m) return false;
    Vector3.TransformCoordinatesFromFloatsToRef(m[12]!, m[13]! + 1.4 * m[5]!, m[14]!, mesh.getWorldMatrix(), point);
    point.subtractToRef(ray.origin, toPoint);
    Vector3.CrossToRef(toPoint, ray.direction, cross);
    return cross.length() <= reach * ray.direction.length();
  };
}

/**
 * The grove a pointer pick landed on: a woodland thin instance names its
 * feature, and the tree it draws (its slot in the grove and its server index,
 * docs/SPEC-GRAMMAIRE-GESTUELLE.md §3), when the grove records them.
 */
export function pickedGrove(pick: {
  pickedMesh: { metadata?: unknown } | null;
  thinInstanceIndex: number;
}): { featureId: string; hint: Cell; slot?: number; treeIndex?: number | null } | null {
  const metadata = pick.pickedMesh?.metadata as
    | {
        instanceFeatureIds?: unknown;
        instanceSlots?: unknown;
        instanceTrees?: unknown;
        cellX?: unknown;
        cellY?: unknown;
      }
    | null
    | undefined;
  if (!metadata || pick.thinInstanceIndex < 0 || !Array.isArray(metadata.instanceFeatureIds)) return null;
  const featureId = metadata.instanceFeatureIds[pick.thinInstanceIndex];
  if (typeof featureId !== 'string' || typeof metadata.cellX !== 'number' || typeof metadata.cellY !== 'number')
    return null;
  const slot = Array.isArray(metadata.instanceSlots) ? metadata.instanceSlots[pick.thinInstanceIndex] : undefined,
    treeIndex = Array.isArray(metadata.instanceTrees) ? metadata.instanceTrees[pick.thinInstanceIndex] : undefined;
  return {
    featureId,
    hint: { cellX: metadata.cellX, cellY: metadata.cellY },
    ...(typeof slot === 'number' ? { slot, treeIndex: typeof treeIndex === 'number' ? treeIndex : null } : {}),
  };
}
