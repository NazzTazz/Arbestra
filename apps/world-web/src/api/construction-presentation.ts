import { reconcileVillageSnapshot, type ConstructionConfirmation, type VillageState } from '@arbestra/contracts';

export function currentConstructionPresentation(state: VillageState, confirmed: ConstructionConfirmation | null) {
  if (!confirmed || confirmed.worldId !== state.world.id || confirmed.villageId !== state.village.id) return null;
  const revision = state.syncRevision ?? -1;
  if (
    revision > confirmed.minimumRevision ||
    (revision === confirmed.minimumRevision && Date.parse(state.serverTime) >= Date.parse(confirmed.serverTime))
  )
    return null;
  return confirmed;
}

export function acceptConstructionPresentation(
  state: VillageState,
  previous: ConstructionConfirmation | null,
  confirmed: ConstructionConfirmation,
  requestGeneration: number,
  currentGeneration: number,
) {
  if (requestGeneration !== currentGeneration || !currentConstructionPresentation(state, confirmed)) return previous;
  const prior = currentConstructionPresentation(state, previous);
  // Placement data are captured before commit; its fence is read afterwards.
  // A delayed fence may be larger for OLDER stocks, so it cannot order the data.
  const timeOrder = prior ? Date.parse(prior.serverTime) - Date.parse(confirmed.serverTime) : 0;
  const minimumRevision = Math.max(prior?.minimumRevision ?? -1, confirmed.minimumRevision);
  if (prior && (timeOrder > 0 || (timeOrder === 0 && prior.minimumRevision >= confirmed.minimumRevision))) {
    if (prior.cellsMode === 'patch' && confirmed.cellsMode === 'patch' && prior.commandId !== confirmed.commandId)
      return { ...prior, minimumRevision, cells: mergeCells(confirmed.cells, prior.cells) };
    return prior;
  }
  if (prior && confirmed.cellsMode === 'patch') {
    const merged = { ...confirmed, minimumRevision, cells: mergeCells(prior.cells, confirmed.cells) };
    if (!prior.cellsMode) delete merged.cellsMode;
    return merged;
  }
  return confirmed;
}

function mergeCells(base: VillageState['cells'], patch: VillageState['cells']) {
  const cells = new Map(base.map((c) => [c.id, c]));
  for (const cell of patch) cells.set(cell.id, cell);
  return [...cells.values()];
}

/** The canonical snapshot/revision stay intact for HTTP/SSE diff application. */
export function constructionPresentationState(
  state: VillageState | null,
  presentation: ConstructionConfirmation | null,
): VillageState | null {
  if (!state) return null;
  const confirmed = currentConstructionPresentation(state, presentation);
  if (!confirmed) return state;
  const wood = confirmed.resources.find((r) => r.code === 'wood'),
    carrots = confirmed.resources.find((r) => r.code === 'carrot');
  return reconcileVillageSnapshot(state, {
    ...state,
    cells: confirmed.cellsMode === 'patch' ? mergeCells(state.cells, confirmed.cells) : confirmed.cells,
    village: {
      ...state.village,
      resources: confirmed.resources,
      wood: wood?.amount ?? state.village.wood,
      carrots: carrots?.amount ?? state.village.carrots,
      woodProductionPerHour: wood?.productionPerHour ?? state.village.woodProductionPerHour,
      woodProductionUpdatedAt: wood?.productionUpdatedAt ?? state.village.woodProductionUpdatedAt,
    },
  });
}
