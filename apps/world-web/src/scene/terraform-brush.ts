import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Constants } from '@babylonjs/core/Engines/constants';
import type { LinesMesh } from '@babylonjs/core/Meshes/linesMesh';
import type { Scene } from '@babylonjs/core/scene';
import { CELL_UNITS, type WorldSpace } from './world-space';

/**
 * The terraforming brush (docs/SPEC-TERRAFORMATION-OUTIL.md §3.2): the 3 × 3
 * cells one painted cell really changes — its four corners move, the eight
 * neighbours slope to them — drawn as one mesh of 4 × 4 shared vertices at
 * the future heights. The centre is opaque, the ring fades to transparent at
 * its outer edge (the outer vertices carry alpha 0, the inner ones 1, and the
 * GPU interpolates the radial fade).
 *
 * Hover is a hot path: one mesh and one line system are built once and only
 * their buffers are rewritten; a hover on the same cell does nothing.
 */
type Cell = { cellX: number; cellY: number };
export const BRUSH_VERTICES = 16;
/** Index of vertex (cellX + dx, cellY + dy), dx and dy in -1..2. */
export const brushVertexIndex = (dx: number, dy: number) => (dy + 1) * 4 + dx + 1;
export const isInnerBrushVertex = (index: number) => {
  const dx = (index % 4) - 1,
    dy = Math.floor(index / 4) - 1;
  return dx >= 0 && dx <= 1 && dy >= 0 && dy <= 1;
};
/** The 3 × 3 cells the brush covers, centre first. */
export function brushCells(cell: Cell, world: { widthCells: number; heightCells: number }): Cell[] {
  const cells = [cell];
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++)
      if (dx || dy)
        cells.push({
          cellX: (cell.cellX + dx + world.widthCells) % world.widthCells,
          cellY: (cell.cellY + dy + world.heightCells) % world.heightCells,
        });
  return cells;
}

/**
 * Future heights of the 16 vertices for a brush on `cell`: the four inner
 * corners at `target` (or as they are when no height is chosen yet), the
 * twelve outer ones as they are. At most 16 `heightAt` calls; false when a
 * height is unknown (ground not loaded).
 */
export function sampleBrushHeights(
  cell: Cell,
  target: number | null,
  world: { widthCells: number; heightCells: number },
  heightAt: (x: number, y: number) => number,
  out: Float64Array,
): boolean {
  for (let dy = -1; dy <= 2; dy++)
    for (let dx = -1; dx <= 2; dx++) {
      const i = brushVertexIndex(dx, dy);
      if (target !== null && isInnerBrushVertex(i)) {
        out[i] = target;
        continue;
      }
      const h = heightAt(
        (cell.cellX + dx + world.widthCells) % world.widthCells,
        (cell.cellY + dy + world.heightCells) % world.heightCells,
      );
      if (!Number.isFinite(h)) return false;
      out[i] = h;
    }
  return true;
}

/** Remembers the last brush so that a hover on the same cell, height and
 * ground revision costs nothing. */
export class BrushCursor {
  readonly heights = new Float64Array(BRUSH_VERTICES);
  #key = '';
  /** 'same': nothing to redraw; 'drawn': `heights` changed; 'missing': ground unknown. */
  update(
    cell: Cell,
    target: number | null,
    revision: number,
    world: { widthCells: number; heightCells: number },
    heightAt: (x: number, y: number) => number,
  ): 'same' | 'drawn' | 'missing' {
    const key = `${cell.cellX}:${cell.cellY}:${target}:${revision}`;
    if (key === this.#key) return 'same';
    this.#key = key;
    if (sampleBrushHeights(cell, target, world, heightAt, this.heights)) return 'drawn';
    this.#key = '';
    return 'missing';
  }
  reset() {
    this.#key = '';
  }
}

export type BrushTone = 'paint' | 'refused' | 'pipette';
const TONES: Record<BrushTone, string> = { paint: '#f5ce55', refused: '#ee776c', pipette: '#8fd3ff' };
/** Fill and line opacity of the centre; the outer edge is fully transparent. */
const FILL_ALPHA = 0.42,
  LINE_ALPHA = 0.95;
/** Triangles of each cell, split like the ground (cellVertices: [0,1,2] and [0,2,3]). */
const INDICES: number[] = [];
/** Vertices of the line system, in order: 4 rows, 4 columns of 4 points, then one diagonal per cell. */
const LINE_POINTS: number[] = [];
for (let j = 0; j < 3; j++)
  for (let i = 0; i < 3; i++) {
    const a = j * 4 + i,
      b = a + 1,
      c = a + 5,
      d = a + 4;
    INDICES.push(a, c, b, a, d, c);
  }
for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) LINE_POINTS.push(j * 4 + i);
for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) LINE_POINTS.push(j * 4 + i);
for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) LINE_POINTS.push(j * 4 + i, j * 4 + i + 5);
const LINE_SHAPES = [4, 4, 4, 4, 4, 4, 4, 4, ...Array<number>(9).fill(2)];

/** Vertex colours of one tone: inner corners opaque, outer ones transparent. */
export function brushColors(tone: BrushTone, alpha: number, indices: readonly number[] | null = null): Float32Array {
  const c = Color3.FromHexString(TONES[tone]),
    order = indices ?? Array.from({ length: BRUSH_VERTICES }, (_, i) => i),
    out = new Float32Array(order.length * 4);
  order.forEach((v, n) => out.set([c.r, c.g, c.b, isInnerBrushVertex(v) ? alpha : 0], n * 4));
  return out;
}

/** Writes the 16 vertex positions around the centre cell's projection. */
export function brushPositions(
  base: { x: number; z: number },
  heights: Float64Array,
  lift: number,
  out: Float32Array,
): Float32Array {
  for (let i = 0; i < BRUSH_VERTICES; i++) {
    const dx = (i % 4) - 1,
      dy = Math.floor(i / 4) - 1;
    out[i * 3] = base.x + (dx - 0.5) * CELL_UNITS;
    out[i * 3 + 1] = heights[i]! * CELL_UNITS + lift;
    out[i * 3 + 2] = base.z + (dy - 0.5) * CELL_UNITS;
  }
  return out;
}

export class TerraformBrush {
  readonly #fill: Mesh;
  readonly #lines: LinesMesh;
  readonly #positions = new Float32Array(BRUSH_VERTICES * 3);
  readonly #linePositions = new Float32Array(LINE_POINTS.length * 3);
  readonly #fillColors: Record<BrushTone, Float32Array>;
  readonly #lineColors: Record<BrushTone, Float32Array>;
  #tone: BrushTone = 'paint';
  #cell: Cell | null = null;
  #heights = new Float64Array(BRUSH_VERTICES);
  /** Buffer writes so far (test probe: one per changed brush). */
  writes = 0;
  constructor(scene: Scene) {
    this.#fillColors = {
      paint: brushColors('paint', 1),
      refused: brushColors('refused', 1),
      pipette: brushColors('pipette', 1),
    };
    this.#lineColors = {
      paint: brushColors('paint', 1, LINE_POINTS),
      refused: brushColors('refused', 1, LINE_POINTS),
      pipette: brushColors('pipette', 1, LINE_POINTS),
    };
    this.#fill = new Mesh('terraform-brush', scene);
    const data = new VertexData();
    data.positions = new Float32Array(BRUSH_VERTICES * 3);
    data.indices = INDICES;
    data.colors = this.#fillColors.paint;
    data.applyToMesh(this.#fill, true);
    this.#fill.hasVertexAlpha = true;
    const material = new StandardMaterial('terraform-brush', scene);
    material.disableLighting = true;
    material.diffuseColor = Color3.White();
    material.emissiveColor = Color3.Black();
    material.specularColor = Color3.Black();
    material.alpha = FILL_ALPHA;
    material.backFaceCulling = false;
    material.disableDepthWrite = true;
    material.depthFunction = Constants.ALWAYS;
    this.#fill.material = material;
    this.#lines = MeshBuilder.CreateLineSystem(
      'terraform-brush-grid',
      {
        lines: LINE_SHAPES.reduce<Vector3[][]>(
          (all, n) => [...all, Array.from({ length: n }, () => Vector3.Zero())],
          [],
        ),
        colors: LINE_SHAPES.map((n) => Array.from({ length: n }, () => new Color4(1, 1, 1, 1))),
        useVertexAlpha: true,
        updatable: true,
      },
      scene,
    );
    this.#lines.updateVerticesData(VertexBuffer.ColorKind, this.#lineColors.paint);
    this.#lines.alpha = LINE_ALPHA;
    if (this.#lines.material) this.#lines.material.depthFunction = Constants.ALWAYS;
    for (const mesh of [this.#fill, this.#lines]) {
      mesh.isPickable = false;
      mesh.renderingGroupId = 2;
      // Never culled on a stale bounding box: the buffers move, not the mesh.
      mesh.alwaysSelectAsActiveMesh = true;
      mesh.setEnabled(false);
    }
  }
  /** Draws the brush on `cell` with these 16 future heights; O(1). */
  show(cell: Cell, heights: Float64Array, tone: BrushTone, space: WorldSpace) {
    this.#cell = cell;
    this.#heights.set(heights);
    if (tone !== this.#tone) {
      this.#tone = tone;
      this.#fill.updateVerticesData(VertexBuffer.ColorKind, this.#fillColors[tone]);
      this.#lines.updateVerticesData(VertexBuffer.ColorKind, this.#lineColors[tone]);
    }
    this.#write(space);
    this.#fill.setEnabled(true);
    this.#lines.setEnabled(true);
  }
  /** After a rebase of the local plane, the same brush at its new place. */
  reproject(space: WorldSpace) {
    if (this.#cell && this.#fill.isEnabled()) this.#write(space);
  }
  hide() {
    this.#cell = null;
    this.#fill.setEnabled(false);
    this.#lines.setEnabled(false);
  }
  #write(space: WorldSpace) {
    const base = space.project(this.#cell!);
    brushPositions(base, this.#heights, 0.04, this.#positions);
    for (let n = 0; n < LINE_POINTS.length; n++) {
      const v = LINE_POINTS[n]!;
      this.#linePositions[n * 3] = this.#positions[v * 3]!;
      this.#linePositions[n * 3 + 1] = this.#positions[v * 3 + 1]! + 0.01;
      this.#linePositions[n * 3 + 2] = this.#positions[v * 3 + 2]!;
    }
    this.#fill.updateVerticesData(VertexBuffer.PositionKind, this.#positions);
    this.#lines.updateVerticesData(VertexBuffer.PositionKind, this.#linePositions);
    this.writes++;
  }
  dispose() {
    this.#fill.dispose(false, true);
    this.#lines.dispose(false, true);
  }
}
