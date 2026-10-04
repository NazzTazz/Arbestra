import type { VillageState } from '@arbestra/contracts';

export function upgradePreview(state: VillageState, siteId: string | null) {
  const site = state.cells.find(cell => cell.id === siteId);
  const building = site?.building ?? state.cells.find(cell => cell.building?.id === site?.footprint?.buildingId)?.building;
  if (!building) return null;
  const definition = state.buildingTypes.find(item => item.code === building.type);
  const next = definition?.levels.find(item => item.level === building.level + 1);
  const error = building.status !== 'completed' ? 'Ce bâtiment est encore en travaux.' : !next ? 'Niveau maximal atteint.'
    : next.costs.some(cost => cost.amount > (cost.resourceCode === 'wood' ? state.village.wood : state.village.resources.find(r => r.code === cost.resourceCode)?.amount ?? 0)) ? 'Ressources insuffisantes.' : null;
  return { siteId, buildingId: building.id, code: building.type, name: definition?.displayName ?? building.type,
    level: building.level, nextLevel: next?.level ?? building.level, costs: next?.costs ?? [],
    durationSeconds: next?.constructionDurationSeconds ?? 0, error };
}
export type UpgradePreview = NonNullable<ReturnType<typeof upgradePreview>>;

/** Only the quote already presented may authorize a command; the server still revalidates. */
export function sameUpgradeQuote(shown: UpgradePreview | null, current: UpgradePreview | null): boolean {
  return !!shown && !!current && !shown.error && !current.error && shown.buildingId === current.buildingId
    && shown.nextLevel === current.nextLevel && JSON.stringify(shown.costs) === JSON.stringify(current.costs);
}
