import type {TerrainVertex} from '@arbestra/contracts';
import {createHash} from 'node:crypto';
import {editedRc1Field, woodlandTrees, woodlandPassage, type GeneratedLandscape, type SpawnTerrace,
  type WoodlandTree, type TravelGround, type createSpawnTerrainField} from '@arbestra/contracts';

/** Transactional, compact edits. The signed substrate is transferred separately. */
export interface Rc1NetworkEdits {
  vertices?: TerrainVertex[];
  worldId: string; width: number; height: number; terraces: SpawnTerrace[]; absent: number[];
  groves: Array<{cellX: number; cellY: number; variantSeed: number; initialAmount: number}>;
}

export function rc1NetworkGround(data: GeneratedLandscape, base: ReturnType<typeof createSpawnTerrainField>,
  edits: Rc1NetworkEdits, field = editedRc1Field(data, base, edits.terraces, [], edits.vertices)): TravelGround {
  const absent = new Set(edits.absent);
  const trees: WoodlandTree[] = (data.forest?.trees ?? []).flatMap((t, i) => absent.has(i) ? []
    : [{x: t.x, y: t.y, scale: t.crown * t.size, heightScale: t.size, rotation: 0}]);
  for (const grove of edits.groves) trees.push(...woodlandTrees({...grove, rc1: {trees: [], rocks: []},
    deposit: {remainingAmount: grove.initialAmount, initialAmount: grove.initialAmount, cleared: false}}));
  const trunks = woodlandPassage(trees, {widthCells: edits.width, heightCells: edits.height});
  const revision = createHash('sha256').update(JSON.stringify([edits.vertices,edits.terraces, trees.map(t => [t.x, t.y, t.scale])])).digest('hex');
  const samples = new Map<string, {elevation: number; dry: boolean; blocked: boolean}>();
  return {width: edits.width, height: edits.height, revision: edits.worldId + ':' + revision, woodedCells: trunks.cells,
    sample(x, y) {
      const key = x + ':' + y, prior = samples.get(key); if (prior) return prior;
      const v = field.sample(x, y), result = {elevation: v.elevation, dry: v.elevation > Math.max(0, v.surface) + 1e-6,
        blocked: field.intersectsRock({x, y, halfWidth: 0, halfHeight: 0}) || trunks.blocked(x, y)};
      if (samples.size >= 32768) samples.clear(); samples.set(key, result); return result;
    }};
}
