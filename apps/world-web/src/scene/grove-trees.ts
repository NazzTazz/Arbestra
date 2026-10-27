import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { woodlandTrees, type WoodlandTree } from '@arbestra/contracts';
import kit from './tree-kit.json';

/**
 * What a grove shows from the server stock (docs/SPEC-BOSQUETS-SOUCHES-REPOUSSE.md §2):
 * every tree slot holds its original tree, or a stump with a young tree beside it,
 * the slot being cut showing its trunk lying down. Pure; the same for every player.
 */
export type TreePiece = keyof typeof kit.pieces;
export type TreeVariant = keyof typeof kit.trunkTop;

export interface GroveSlot {
  index: number;
  /** Full-grown tree of this slot, as the server's navigation sees it. */
  tree: WoodlandTree;
  variant: TreeVariant;
  /** Original tree still standing. */
  standing: boolean;
  /** Trunk of the slot being cut, lying down: share of its length left, 0 when none. */
  lying: number;
  stump: 'souche-a' | 'souche-b' | null;
  /** Young tree beside the stump: piece and its scale relative to the original tree, or null. */
  young: { piece: TreePiece | TreeVariant; scale: number } | null;
}

type GroveInput = Parameters<typeof woodlandTrees>[0] & {
  deposit?: { initialAmount: number; remainingAmount: number; cutAmount?: number; cleared?: boolean } | null;
};

const hash = (seed: number, i: number) => {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(i + 1, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  return ((h ^ (h >>> 12)) >>> 0) / 4294967296;
};
const SAPINS: TreeVariant[] = ['sapin-a', 'sapin-b', 'sapin-c'];
/** A young tree shows from this share of its slot's wood; smaller, nothing but the stump. */
const YOUNG_VISIBLE = 0.15;

/** One broadleaf for four firs, drawn from the grove seed and the slot. */
export function treeVariant(seed: number, index: number): TreeVariant {
  const r = hash(seed, index);
  return r < 0.2 ? 'feuillu-a' : SAPINS[Math.min(2, Math.floor(((r - 0.2) / 0.8) * 3))]!;
}

export function groveSlots(feature: GroveInput): GroveSlot[] {
  const deposit = feature.deposit;
  if (deposit?.cleared) return [];
  // Full-grown trees: the stock now removes trees instead of shrinking them.
  const trees = woodlandTrees({
    ...feature,
    deposit: deposit ? { ...deposit, remainingAmount: deposit.initialAmount, cleared: false } : null,
  } as Parameters<typeof woodlandTrees>[0]);
  const n = trees.length;
  if (!n) return [];
  const initial = deposit?.initialAmount ?? 1,
    share = initial / n,
    cut = Math.max(0, deposit?.cutAmount ?? 0),
    stock = Math.max(0, deposit?.remainingAmount ?? initial);
  // Slots ever cut, in the grove's own order (shared by every village).
  const stumps = Math.min(n, Math.ceil(cut / share - 1e-9));
  const partial = cut / share - Math.floor(cut / share + 1e-9);
  const lyingSlot = partial > 1e-9 ? Math.min(n, stumps) - 1 : -1,
    lyingShare = lyingSlot >= 0 ? 1 - partial : 0;
  // Wood beyond the originals still standing and the lying trunk grows back beside the stumps.
  let regrown = Math.max(0, stock - (n - stumps) * share - lyingShare * share);
  return trees.map((tree, index) => {
    const variant = treeVariant(feature.variantSeed, index),
      stumped = index < stumps;
    let young: GroveSlot['young'] = null;
    if (stumped && index !== lyingSlot) {
      const part = Math.min(1, regrown / share);
      regrown -= part * share;
      if (part >= YOUNG_VISIBLE)
        young =
          part < 0.4
            ? { piece: 'pousse-plant', scale: 0.6 + part }
            : part < 0.75
              ? { piece: 'pousse-arbuste', scale: 0.5 + part / 2 }
              : { piece: variant, scale: part };
    }
    return {
      index,
      tree,
      variant,
      standing: !stumped,
      lying: index === lyingSlot ? lyingShare : 0,
      stump: stumped ? (hash(feature.variantSeed, index + 997) < 0.5 ? 'souche-a' : 'souche-b') : null,
      young,
    };
  });
}

/** Side offset of a young tree from its stump, in cells, so both stay readable. */
export function youngOffset(seed: number, index: number) {
  const angle = hash(seed, index + 31) * Math.PI * 2;
  return { x: Math.cos(angle) * 0.09, y: Math.sin(angle) * 0.09 };
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
