import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import {
  treeWood,
  woodlandTrees,
  WOOD_PER_TREE,
  type NaturalFeature,
  type StoneDeposit,
  type TreeState,
  type WoodlandTree,
} from '@arbestra/contracts';
import kit from './tree-kit.json';

/**
 * What a grove shows, tree by tree, from the server (docs/SPEC-BOIS-ARBRE-UNITE.md
 * §2, `deposit.trees` since slice 2d): an untouched tree stands; a felled one
 * lies on the ground, as long as its wood left, beside its stump; then only its
 * stump; nothing once the stump is removed. No regrowth any more (no young
 * trees). Pure; the same for every player.
 */
export type TreePiece = keyof typeof kit.pieces;
export type TreeVariant = keyof typeof kit.trunkTop;
export type StumpPiece = 'souche-a' | 'souche-b';
export const isStumpPiece = (piece: TreePiece): piece is StumpPiece => piece === 'souche-a' || piece === 'souche-b';

export interface GroveSlot {
  /** Place of the tree in its grove's drawn order. */
  index: number;
  /** The server's tree index (the RC1 index, else the drawn order); null when an
   * older server does not name an RC1 tree: it cannot be designated alone. */
  treeIndex: number | null;
  /** Full-grown tree of this slot, as the server's navigation sees it. */
  tree: WoodlandTree;
  variant: TreeVariant;
  state: TreeState;
  /** Original tree still standing. */
  standing: boolean;
  /** Trunk of a felled tree on the ground: its wood left over a whole tree's, 0 when none. */
  lying: number;
  /** Stump drawn (a felled tree or a stump), or null. */
  stump: StumpPiece | null;
  /** The kit stump of this tree, whatever its state. */
  stumpPiece: StumpPiece;
  /** Wood left on the tree (a whole tree while standing). */
  remaining: number;
  /** Wood free to cut: what is left, less the lots already reserved. */
  available: number;
}

type GroveInput = Pick<NaturalFeature, 'cellX' | 'cellY' | 'variantSeed' | 'rc1'> & {
  deposit?: Pick<StoneDeposit, 'initialAmount' | 'remainingAmount' | 'cleared' | 'trees'> | null;
};

const hash = (seed: number, i: number) => {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(i + 1, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  return ((h ^ (h >>> 12)) >>> 0) / 4294967296;
};
const SAPINS: TreeVariant[] = ['sapin-a', 'sapin-b', 'sapin-c'];

/** One broadleaf for four firs, drawn from the grove seed and the slot. */
export function treeVariant(seed: number, index: number): TreeVariant {
  const r = hash(seed, index);
  return r < 0.2 ? 'feuillu-a' : SAPINS[Math.min(2, Math.floor(((r - 0.2) / 0.8) * 3))]!;
}

export function groveSlots(feature: GroveInput): GroveSlot[] {
  const deposit = feature.deposit;
  if (deposit?.cleared) return [];
  // Full-grown trees: a tree is cut down, never shrunk.
  const trees = woodlandTrees({
    ...feature,
    deposit: deposit
      ? { initialAmount: deposit.initialAmount, remainingAmount: deposit.initialAmount, cleared: false }
      : null,
  });
  const rc1 = feature.rc1?.trees.length ? feature.rc1.trees : null,
    records = new Map((deposit?.trees ?? []).map((t) => [t.treeIndex, t]));
  return trees.map((tree, index) => {
    const treeIndex = rc1 ? (rc1[index]?.index ?? null) : index,
      wood = treeWood(treeIndex === null ? undefined : records.get(treeIndex)),
      stumpPiece: StumpPiece = hash(feature.variantSeed, index + 997) < 0.5 ? 'souche-a' : 'souche-b';
    return {
      index,
      treeIndex,
      tree,
      variant: treeVariant(feature.variantSeed, index),
      state: wood.state,
      standing: wood.state === 'standing',
      lying: wood.state === 'felled' ? Math.min(1, wood.remaining / WOOD_PER_TREE) : 0,
      stump: wood.state === 'felled' || wood.state === 'stump' ? stumpPiece : null,
      stumpPiece,
      remaining: wood.remaining,
      available: wood.available,
    };
  });
}

/**
 * What decides the geometry of a grove's meshes: its trees and their places,
 * not their state. A felled tree, a shorter trunk or a removed stump redraws
 * its own instances (grove-instances.ts), never the grove.
 */
export function woodlandSignature(feature: NaturalFeature): string {
  return JSON.stringify([
    feature.id,
    feature.cellX,
    feature.cellY,
    feature.variantSeed,
    feature.rc1?.trees ?? null,
    feature.deposit?.cleared ?? false,
    // Without RC1 forest, the stored wood gives the number of trees.
    feature.rc1 ? null : (feature.deposit?.initialAmount ?? null),
    // Stump pieces are built at a grove's first felled tree only: one rebuild then.
    groveHasStumps(feature),
  ]);
}

/**
 * Whether a grove shows a stump (a felled tree, or a stump not removed yet).
 * An untouched grove builds no stump mesh at all (loading cost); its first
 * felled tree changes the grove's signature, and the grove is rebuilt once.
 */
export function groveHasStumps(feature: Pick<NaturalFeature, 'deposit'>): boolean {
  return feature.deposit?.trees?.some((t) => Boolean(t.felledAt) && !t.stumpRemoved) ?? false;
}

const decoded = new Map<TreePiece, VertexData>();
/** Kit piece as vertex data: unindexed triangles, colours per vertex (blender-elements/arbres). */
export function treePieceData(name: TreePiece): VertexData {
  const cached = decoded.get(name);
  if (cached) return cached;
  const piece = kit.pieces[name],
    count = piece.positions.length / 3;
  const positions = new Float32Array(count * 3),
    colors = new Float32Array(count * 4),
    indices = new Uint32Array(count),
    normals = new Float32Array(count * 3);
  for (let i = 0; i < positions.length; i++) positions[i] = piece.positions[i]! * kit.units.position;
  for (let v = 0; v < count; v++)
    colors.set(
      [
        piece.colors[v * 3]! * kit.units.color,
        piece.colors[v * 3 + 1]! * kit.units.color,
        piece.colors[v * 3 + 2]! * kit.units.color,
        1,
      ],
      v * 4,
    );
  // Blender faces turn counter-clockwise seen from outside; the scene is left-handed.
  for (let i = 0; i < count; i += 3) indices.set([i, i + 2, i + 1], i);
  VertexData.ComputeNormals(positions, indices, normals);
  const data = new VertexData();
  Object.assign(data, { positions, colors, indices, normals });
  decoded.set(name, data);
  return data;
}

/** Height of a variant's trunk under its foliage, in kit units. */
export const trunkTop = (variant: TreeVariant) => kit.trunkTop[variant];
