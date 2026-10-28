import type { VillageCell, VillageState } from '@arbestra/contracts';

export interface SiteSignatureContext {
  murets: unknown;
  gardenStage: number | undefined;
  fullGarden: boolean;
  gardenKit: boolean;
  highlighted: boolean;
}

/**
 * What a cached building mesh is generated from. The site is located by its
 * canonical cell, not its local x/z: a rebase of the local frame moves the
 * cached meshes, and rebuilding them all on the next update cost 3 to 13 s on a
 * 66-building village (garden kit arrival, 28 October).
 */
export function siteSignature(state: VillageState, site: VillageCell, context: SiteSignatureContext): string {
  const footprint = site.building
    ? state.cells.filter((c) => c.footprint?.buildingId === site.building!.id).map((c) => [c.cellX, c.cellY])
    : [];
  const garden = site.building?.type === 'garden' || site.footprint?.buildingType === 'garden';
  return JSON.stringify([
    state.world.id,
    [site.cellX, site.cellY],
    site.building?.type,
    site.building?.status,
    site.building?.level,
    site.building?.targetLevel,
    site.building?.visualLayout,
    site.building?.quarterTurns,
    footprint,
    context.murets,
    site.footprint?.state,
    context.gardenStage,
    context.fullGarden,
    garden ? context.gardenKit : null,
    site.building?.type === 'university' ? [state.science?.levels.mathematics, state.science?.levels.astronomy] : null,
    !site.building && !site.footprint ? [site.canBuild, context.highlighted] : null,
  ]);
}
