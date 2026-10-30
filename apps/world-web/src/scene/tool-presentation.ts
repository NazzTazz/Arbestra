import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Scene } from '@babylonjs/core/scene';

export const TOOL_PRESENTATIONS = ['tools-symbol', 'tool:terraform', 'tool:demolish'] as const;
export type ToolPresentation = (typeof TOOL_PRESENTATIONS)[number];
export const isToolPresentation = (code: string): code is ToolPresentation =>
  (TOOL_PRESENTATIONS as readonly string[]).includes(code);

function material(scene: Scene, name: string, colour: string, emissive?: string) {
  const m = new StandardMaterial(`tool-${name}`, scene);
  m.diffuseColor = Color3.FromHexString(colour);
  m.specularColor = Color3.Black();
  if (emissive) m.emissiveColor = Color3.FromHexString(emissive);
  return m;
}

/**
 * A piece of construction grid, drawn like a hash sign: one whole cell between
 * four lines running past it, the cell raised under a blue veil.
 */
function terraformCell(root: Mesh, scene: Scene) {
  const line = material(scene, 'grid-line', '#e8eef2', '#3a4248'),
    grass = material(scene, 'grass', '#6f8a45'),
    earth = material(scene, 'earth', '#7a5634'),
    veil = material(scene, 'veil', '#4f9be0', '#1d4f86');
  veil.alpha = 0.45;
  for (const offset of [-0.5, 0.5]) {
    const along = MeshBuilder.CreateBox('tool-grid-line', { width: 2.3, height: 0.05, depth: 0.07 }, scene);
    along.position.set(0, 0.025, offset);
    const across = MeshBuilder.CreateBox('tool-grid-line', { width: 0.07, height: 0.05, depth: 2.3 }, scene);
    across.position.set(offset, 0.025, 0);
    for (const bar of [along, across]) {
      bar.material = line;
      bar.parent = root;
    }
  }
  const height = 0.32;
  const column = MeshBuilder.CreateBox('tool-terrain', { width: 0.9, depth: 0.9, height }, scene);
  column.position.y = height / 2;
  column.material = earth;
  column.parent = root;
  const top = MeshBuilder.CreateBox('tool-grass', { width: 0.9, depth: 0.9, height: 0.06 }, scene);
  top.position.y = height + 0.03;
  top.material = grass;
  top.parent = root;
  const cover = MeshBuilder.CreateBox('tool-veil', { width: 0.96, depth: 0.96, height: height + 0.1 }, scene);
  cover.position.y = (height + 0.1) / 2;
  cover.material = veil;
  cover.parent = root;
}

function shovel(root: Mesh, scene: Scene, x: number, z: number, lean: number) {
  const wood = material(scene, 'handle', '#a8672f'),
    iron = material(scene, 'iron', '#8d949b');
  const handle = MeshBuilder.CreateCylinder('tool-shovel-handle', { diameter: 0.17, height: 1.5 }, scene);
  handle.position.set(x, 1.05, z);
  handle.rotation.z = lean;
  handle.material = wood;
  handle.parent = root;
  const blade = MeshBuilder.CreateBox('tool-shovel-blade', { width: 0.55, height: 0.62, depth: 0.1 }, scene);
  blade.position.set(x + Math.sin(lean) * 0.85, 1.05 - Math.cos(lean) * 0.85, z);
  blade.rotation.z = lean;
  blade.material = iron;
  blade.parent = root;
}

function hammer(root: Mesh, scene: Scene, x: number, y: number, z: number, lean: number) {
  const wood = material(scene, 'hammer-handle', '#794521'),
    iron = material(scene, 'hammer-head', '#5c6168');
  const handle = MeshBuilder.CreateCylinder('tool-hammer-handle', { diameter: 0.18, height: 1.4 }, scene);
  handle.position.set(x, y, z);
  handle.rotation.z = lean;
  handle.material = wood;
  handle.parent = root;
  const head = MeshBuilder.CreateBox('tool-hammer-head', { width: 0.85, height: 0.4, depth: 0.4 }, scene);
  head.position.set(x - Math.sin(lean) * 0.7, y + Math.cos(lean) * 0.7, z);
  head.rotation.z = lean;
  head.material = iron;
  head.parent = root;
}

/** Collapsed wall: scattered blocks under a sledgehammer, lit by the demolition red. */
function rubble(root: Mesh, scene: Scene) {
  const stone = material(scene, 'rubble', '#9a9285'),
    marked = material(scene, 'marked', '#c8453b', '#5a1410');
  const blocks = [
    [-0.6, 0, -0.2, 0.2],
    [-0.15, 0, -0.35, -0.4],
    [0.3, 0, -0.1, 0.6],
    [-0.35, 0.22, -0.25, 0.1],
    [0.1, 0.22, -0.2, -0.2],
    [0.55, 0, 0.35, 0.3],
    [-0.5, 0, 0.35, -0.6],
  ] as const;
  blocks.forEach(([x, y, z, turn], index) => {
    const block = MeshBuilder.CreateBox('tool-rubble', { width: 0.42, height: 0.22, depth: 0.26 }, scene);
    block.position.set(x, y + 0.11, z);
    block.rotation.y = turn;
    block.material = index % 3 ? stone : marked;
    block.parent = root;
  });
}

export function buildToolPresentation(root: Mesh, scene: Scene, code: ToolPresentation) {
  if (code === 'tool:terraform') {
    terraformCell(root, scene);
  } else if (code === 'tool:demolish') {
    rubble(root, scene);
    hammer(root, scene, 0.15, 0.95, 0.1, -0.6);
  } else {
    shovel(root, scene, -0.25, 0, 0.45);
    hammer(root, scene, 0.3, 1, 0, -0.45);
  }
}
