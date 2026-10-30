import type { InfrastructurePlan, RoadCell } from '@arbestra/contracts';

type Cells = readonly Pick<RoadCell, 'cellX' | 'cellY' | 'surface' | 'sidewalks'>[] | undefined;

/**
 * The rendered plan: the historical stroke plan plus the village's road cells
 * (docs/SPEC-INFRASTRUCTURE-CASES-ET-PLACES.md §4.3), rasterized by
 * `infrastructurePlanSurface` as centred chemins whose elbows, T and crossings
 * follow the four neighbours. The result keeps its identity while neither the
 * plan nor the cells' content change, so renderers keyed on it do no work on
 * unrelated village publications (V2 rebuilds the cell array on every delta).
 */
export class RoadCellsPlan {
  #plan: InfrastructurePlan | null = null;
  #cells: Cells = undefined;
  #signature = '';
  #result: InfrastructurePlan | null = null;
  compose(plan: InfrastructurePlan, cells: Cells): InfrastructurePlan {
    if (plan === this.#plan && cells === this.#cells && this.#result) return this.#result;
    let signature = '';
    for (const c of cells ?? []) signature += `${c.cellX},${c.cellY},${c.surface},${c.sidewalks ? 1 : 0};`;
    if (plan !== this.#plan || signature !== this.#signature || !this.#result)
      this.#result = signature
        ? {
            ...plan,
            roadCells: cells!.map(({ cellX, cellY, surface, sidewalks }) => ({ cellX, cellY, surface, sidewalks })),
          }
        : plan;
    this.#plan = plan;
    this.#cells = cells;
    this.#signature = signature;
    return this.#result;
  }
}
