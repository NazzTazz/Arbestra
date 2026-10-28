import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import type { Scene } from '@babylonjs/core/scene';
import { CELL_UNITS } from './world-space';

/**
 * The building workshop's footprint grid, centred on `parent`: white cell
 * lines, blue sub-cell lines and brighter half-cell lines, drawn in rendering
 * group 1 (the caller keeps that group's depth).
 */
export function buildFootprintGrid(scene: Scene, parent: Mesh, columns: number, rows: number, subdivisions = 8): void {
  const width = columns * CELL_UNITS,
    depth = rows * CELL_UNITS,
    lines: Vector3[][] = [];
  for (let x = 0; x <= columns; x++)
    lines.push([
      new Vector3(-width / 2 + x * CELL_UNITS, 0.014, -depth / 2),
      new Vector3(-width / 2 + x * CELL_UNITS, 0.014, depth / 2),
    ]);
  for (let z = 0; z <= rows; z++)
    lines.push([
      new Vector3(-width / 2, 0.014, -depth / 2 + z * CELL_UNITS),
      new Vector3(width / 2, 0.014, -depth / 2 + z * CELL_UNITS),
    ]);
  const grid = MeshBuilder.CreateLineSystem('workshop-footprint-grid', { lines }, scene);
  grid.color = Color3.FromHexString('#ffffff');
  grid.alpha = 0.95;
  grid.parent = parent;
  grid.isPickable = false;
  grid.renderingGroupId = 1;
  if (subdivisions <= 1) return;
  const minorLines: Vector3[][] = [],
    halfLines: Vector3[][] = [],
    step = CELL_UNITS / subdivisions;
  for (let x = 1; x < columns * subdivisions; x++)
    if (x % subdivisions) {
      const group = x % subdivisions === subdivisions / 2 ? halfLines : minorLines;
      group.push([
        new Vector3(-width / 2 + x * step, 0.014, -depth / 2),
        new Vector3(-width / 2 + x * step, 0.014, depth / 2),
      ]);
    }
  for (let z = 1; z < rows * subdivisions; z++)
    if (z % subdivisions) {
      const group = z % subdivisions === subdivisions / 2 ? halfLines : minorLines;
      group.push([
        new Vector3(-width / 2, 0.014, -depth / 2 + z * step),
        new Vector3(width / 2, 0.014, -depth / 2 + z * step),
      ]);
    }
  const minorGrid = MeshBuilder.CreateLineSystem('workshop-subcell-grid', { lines: minorLines }, scene);
  minorGrid.color = Color3.FromHexString('#214e91');
  minorGrid.alpha = 0.38;
  minorGrid.parent = parent;
  minorGrid.isPickable = false;
  minorGrid.renderingGroupId = 1;
  if (halfLines.length) {
    const halfGrid = MeshBuilder.CreateLineSystem('workshop-halfcell-grid', { lines: halfLines }, scene);
    halfGrid.color = Color3.FromHexString('#4685cf');
    halfGrid.alpha = 0.72;
    halfGrid.parent = parent;
    halfGrid.isPickable = false;
    halfGrid.renderingGroupId = 1;
  }
}
