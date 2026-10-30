import { jsonDataEqual, type VillageState } from '@arbestra/contracts';

export type TravelDerivationState = Pick<
  VillageState,
  'world' | 'travelRoutes' | 'infrastructure' | 'cells' | 'region'
>;

/** Inputs of the scene's travel derivation (accesses, barriers, braziers,
 * displayed roads). Called on every published state: the reconciliation keeps
 * the identity of unchanged branches, so identity decides first and only a
 * changed identity is compared by content (equal content after a reset that
 * did not keep identities: the derivation is still reused). Nothing is
 * serialized (`travelRoutes` alone is ~200 kB on Bressuire). */
export class TravelDerivationInputs {
  #buildings: unknown[] | undefined;
  #features: unknown[] | undefined;
  constructor(readonly state: TravelDerivationState) {}
  get buildings(): unknown[] {
    return (this.#buildings ??= this.state.cells
      .filter((c) => c.footprint || c.building)
      .map((c) => [
        c.cellX,
        c.cellY,
        c.footprint,
        c.building && [
          c.building.id,
          c.building.type,
          c.building.visualLayout,
          c.building.quarterTurns,
          c.building.accesses,
        ],
      ]));
  }
  get features(): unknown[] {
    return (this.#features ??= this.state.region.features.map((f) => [
      f.cellX,
      f.cellY,
      f.deposit?.blocksCell,
      f.deposit?.cleared,
      f.deposit?.state,
    ]));
  }
  sameAs(previous: TravelDerivationInputs | null): boolean {
    if (!previous) return false;
    const a = previous.state,
      b = this.state;
    const same = (x: unknown, y: unknown) => x === y || jsonDataEqual(x, y);
    return (
      a.world.id === b.world.id &&
      a.region.originCellX === b.region.originCellX &&
      a.region.originCellY === b.region.originCellY &&
      same(a.travelRoutes, b.travelRoutes) &&
      same(a.infrastructure, b.infrastructure) &&
      same(a.region.terrainCodes, b.region.terrainCodes) &&
      (a.cells === b.cells || jsonDataEqual(previous.buildings, this.buildings)) &&
      (a.region.features === b.region.features || jsonDataEqual(previous.features, this.features))
    );
  }
}
