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

/** Terraced ground: one side keeps its slope, the other is levelled to a single plateau. */
function terrace(root: Mesh, scene: Scene) {
  const grass = material(scene, 'grass', '#6f8a45'),
    earth = material(scene, 'earth', '#7a5634');
  for (let x = -2; x <= 2; x++)
    for (let z = -2; z <= 2; z++) {
      const height = x >= 1 ? 0.45 : 0.15 + 0.3 * Math.max(0, 2 - Math.hypot(x + 0.5, z * 0.8)) + 0.12 * ((x + z) & 1);
      const column = MeshBuilder.CreateBox('tool-terrain', { width: 0.5, depth: 0.5, height }, scene);
      column.position.set(x * 0.5, height / 2, z * 0.5);
      column.material = earth;
      column.parent = root;
      const top = MeshBuilder.CreateBox('tool-grass', { width: 0.5, depth: 0.5, height: 0.06 }, scene);
      top.position.set(x * 0.5, height + 0.03, z * 0.5);
      top.material = grass;
      top.parent = root;
    }
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
    terrace(root, scene);
    shovel(root, scene, 0.8, -0.2, -0.35);
  } else if (code === 'tool:demolish') {
    rubble(root, scene);
    hammer(root, scene, 0.15, 0.95, 0.1, -0.6);
  } else {
    shovel(root, scene, -0.25, 0, 0.45);
    hammer(root, scene, 0.3, 1, 0, -0.45);
  }
}
