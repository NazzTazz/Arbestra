import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Scene } from '@babylonjs/core/scene';
import kit from './villager-kit.json';

export const WORKER_COLOURS = {
  skin: ['#e2ba94', '#b98157', '#684532'],
  clothes: ['#42604a', '#526e86', '#b69a4c', '#a95f47', '#d9cfb4'],
  hair: ['#2d231e', '#745039', '#c4a364'],
  pants: '#4b4033',
} as const;

/** Figurine pieces exported by blender-elements/villageois/sources/export_jeu.py. */
export type VillagerPiece = keyof typeof kit.pieces;
export type HairStyle = 'court' | 'chignon' | 'long';
export type VillagerHat = 'paille' | 'bonnet' | 'casque' | 'beret';
export type VillagerTool = 'hache' | 'merlin' | 'pioche' | 'masse';
/** Tinted pieces take their material's colour; `white` pieces carry absolute vertex colours. */
export type PieceTint = 'skin' | 'clothes' | 'hair' | 'pants' | 'white';
export const HAIR_STYLES: readonly HairStyle[] = ['court', 'chignon', 'long'];

const decoded = new Map<VillagerPiece, VertexData>();
/** Flat-shaded triangles of one piece, in the frame of the joint that carries it. */
export function villagerPieceData(name: VillagerPiece): VertexData {
  const cached = decoded.get(name);
  if (cached) return cached;
  const piece = kit.pieces[name],
    count = piece.positions.length / 3;
  const positions = new Float32Array(count * 3),
    colors = new Float32Array(count * 4),
    indices = new Uint32Array(count),
    normals = new Float32Array(count * 3);
  for (let i = 0; i < positions.length; i++) positions[i] = piece.positions[i]! * kit.units.position;
  for (let v = 0; v < count; v++) {
    const t = Math.floor(v / 3) * 3,
      c = kit.units.color;
    colors.set([piece.colors[t]! * c, piece.colors[t + 1]! * c, piece.colors[t + 2]! * c, 1], v * 4);
  }
  // Blender faces turn counter-clockwise seen from outside; the scene is left-handed.
  for (let i = 0; i < count; i += 3) indices.set([i, i + 2, i + 1], i);
  VertexData.ComputeNormals(positions, indices, normals);
  const data = new VertexData();
  Object.assign(data, { positions, colors, indices, normals });
  decoded.set(name, data);
  return data;
}

type Piece = (name: VillagerPiece, tint: PieceTint, parent: TransformNode) => Mesh;
export interface VillagerRig {
  /** Waist pivot: torso, head and arms lean together around X; legs stay. */
  waist: TransformNode;
  /** Left arm, right arm (carries the tool), left leg, right leg. */
  limbs: TransformNode[];
}

/**
 * Shared figurine for animated villagers and their factory portraits. The first
 * two pieces are the tunic and the head, which carry selection metadata.
 */
export function buildWorkerFigure(
  root: TransformNode,
  piece: Piece,
  style: HairStyle,
  hat: VillagerHat | null,
): VillagerRig {
  const scene = root.getScene(),
    { pivots } = kit,
    limbs: TransformNode[] = [];
  const waist = new TransformNode(`${root.name}-waist`, scene);
  waist.parent = root;
  waist.position.y = pivots.waist;
  piece('tunique', 'clothes', waist);
  piece('tete', 'skin', waist);
  piece(`cheveux-${style}`, 'hair', waist);
  if (hat) piece(`chapeau-${hat}`, 'white', waist);
  for (const side of [-1, 1]) {
    const arm = new TransformNode(`${root.name}-arm`, scene);
    arm.parent = waist;
    arm.position.set(side * pivots.arm[0]!, pivots.arm[1]!, 0);
    piece('bras', 'clothes', arm);
    piece('main', 'skin', arm);
    limbs.push(arm);
  }
  for (const side of [-1, 1]) {
    const leg = new TransformNode(`${root.name}-leg`, scene);
    leg.parent = root;
    leg.position.set(side * pivots.leg[0]!, pivots.leg[1]!, 0);
    piece('jambe', 'pants', leg);
    limbs.push(leg);
  }
  return { waist, limbs };
}

export function buildWorkerPresentation(scene: Scene, count: number): Mesh {
  const group = new Mesh(`workers-${count}`, scene);
  const material = (name: string, colour: string) => {
    const m = new StandardMaterial(name, scene);
    m.diffuseColor = Color3.FromHexString(colour);
    m.specularColor = Color3.Black();
    return m;
  };
  const skin = WORKER_COLOURS.skin.map((c, i) => material(`portrait-skin-${i}`, c)),
    clothes = WORKER_COLOURS.clothes.map((c, i) => material(`portrait-clothes-${i}`, c)),
    hair = WORKER_COLOURS.hair.map((c, i) => material(`portrait-hair-${i}`, c)),
    pants = material('portrait-pants', WORKER_COLOURS.pants),
    white = material('portrait-white', '#ffffff');
  const positions =
    count === 1
      ? [[0, 0]]
      : count === 2
        ? [
            [-0.19, 0],
            [0.19, 0],
          ]
        : [
            [-0.28, 0.12],
            [0.28, 0.12],
            [0, -0.15],
          ];
  positions.forEach(([x, z], i) => {
    const root = new TransformNode(`portrait-${i}`, scene);
    root.parent = group;
    root.position.set(x!, 0, z!);
    root.rotation.y = Math.PI;
    const materials = { skin: skin[i % 3]!, clothes: clothes[i % 3]!, hair: hair[i % 3]!, pants, white };
    const piece: Piece = (name, tint, parent) => {
      const mesh = new Mesh(`portrait-${i}-${name}`, scene);
      villagerPieceData(name).applyToMesh(mesh);
      mesh.parent = parent;
      mesh.material = materials[tint];
      return mesh;
    };
    buildWorkerFigure(root, piece, HAIR_STYLES[i % 3]!, null);
  });
  return group;
}
