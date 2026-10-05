import type { VillageState } from '@arbestra/contracts';
import type { Cell } from '../scene/construction-selection';

/** Resolve the gesture's origin, not whichever neighbour its last cell touches. */
export function constructionContext(state: VillageState, type: string, first: Cell, last: Cell):
  { action: 'build' | 'upgrade' | 'extend'; buildingId?: string; siteId?: string } {
  const at = (cell: Cell) => {
    const site = state.cells.find(c => c.cellX === cell.cellX && c.cellY === cell.cellY);
    const owner = site?.building ? site : state.cells.find(c => c.building?.id === site?.footprint?.buildingId);
    return owner?.building ? owner : null;
  };
  const origin = at(first), target = at(last);
  if (origin?.building?.type !== type) return { action: 'build' };
  if (type === 'garden') return { action: 'extend', buildingId: origin.building.id, siteId: origin.id };
  if (target?.building?.id === origin.building.id)
    return { action: 'upgrade', buildingId: origin.building.id, siteId: origin.id };
  return { action: 'build' };
}

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
