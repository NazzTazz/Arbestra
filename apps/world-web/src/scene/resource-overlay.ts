import type { Ray } from '@babylonjs/core/Culling/ray.core';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { NaturalFeature } from '@arbestra/contracts';
import { cellKey, type Cell } from './construction-selection';
import type { ResourceHaloCell } from './resource-halos';
import { groveHalo, type TreeHaloGrove } from './tree-halos';
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
}

/**
 * What the Exploitation overlay offers: a halo per cell for gardens and stone,
 * a halo per standing tree for wood. Groves are kept whole and taken nearest
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
  const groves = new Map<string, TreeHaloGrove>();
  for (const f of input.features) {
    if (!f.deposit || f.deposit.cleared || f.deposit.availableAmount <= 0) continue;
    if (f.deposit.resourceCode === 'wood') {
      const grove = groveHalo(f, world.chunkSize);
      if (grove && !groves.has(grove.featureId) && input.shown(f)) groves.set(grove.featureId, grove);
    } else cells.set(cellKey(f), { ...f, resource: f.deposit.resourceCode });
  }
  const visibleCells = [...cells.values()]
    .filter((c) => input.shown(c))
    .sort((a, b) => distance(a) - distance(b))
    .slice(0, input.cellCap ?? RESOURCE_OVERLAY_CELL_CAP);
  const visibleGroves: TreeHaloGrove[] = [];
  let trees = 0;
  for (const grove of [...groves.values()].sort((a, b) => distance(a) - distance(b))) {
    if (visibleGroves.length && trees + grove.trees.length > (input.treeCap ?? RESOURCE_OVERLAY_TREE_CAP)) break;
    visibleGroves.push(grove);
    trees += grove.trees.length;
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

/** The grove a pointer pick landed on: a woodland thin instance names its feature. */
export function pickedGrove(pick: {
  pickedMesh: { metadata?: unknown } | null;
  thinInstanceIndex: number;
}): { featureId: string; hint: Cell } | null {
  const metadata = pick.pickedMesh?.metadata as
    | { instanceFeatureIds?: unknown; cellX?: unknown; cellY?: unknown }
    | null
    | undefined;
  if (!metadata || pick.thinInstanceIndex < 0 || !Array.isArray(metadata.instanceFeatureIds)) return null;
  const featureId = metadata.instanceFeatureIds[pick.thinInstanceIndex];
  if (typeof featureId !== 'string' || typeof metadata.cellX !== 'number' || typeof metadata.cellY !== 'number')
    return null;
  return { featureId, hint: { cellX: metadata.cellX, cellY: metadata.cellY } };
}
