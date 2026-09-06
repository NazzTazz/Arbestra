import type { VillageState } from '@arbestra/contracts';
export type WorldFeature = VillageState['region']['features'][number];

export function terrainSignature(state: VillageState): string {
  return `${state.world.id}:${state.world.generationVersion}:${state.region.originCellX}:${state.region.originCellY}:${state.village.anchorCellX}:${state.village.anchorCellY}`;
}

export function stoneVisualSignature(feature: WorldFeature, origin: string): string {
  return `${origin}:${feature.cellX}:${feature.cellY}:${feature.variantSeed}:${feature.deposit?.revision}:${feature.deposit?.state}`;
}

export function changedStoneFeatures(previous: ReadonlyMap<string, string>, features: WorldFeature[], origin: string) {
  const stones = features.filter((feature) => feature.type === 'stone_outcrop');
  const ids = new Set(stones.map((feature) => feature.id));
  return { removed: [...previous.keys()].filter((id) => !ids.has(id)),
    changed: stones.filter((feature) => previous.get(feature.id) !== stoneVisualSignature(feature, origin)) };
}

/** Visual round trip only: quarter out, half at work, quarter back. */
export function extractionTravel(now: number, startedAt: number, completesAt: number): number {
  const phase = Math.max(0, Math.min(1, (now - startedAt) / (completesAt - startedAt)));
  return phase < 0.25 ? phase * 4 : phase <= 0.75 ? 1 : (1 - phase) * 4;
}
