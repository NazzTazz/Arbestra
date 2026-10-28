import { expect, it } from 'vitest';
import type { VillageCell, VillageState } from '@arbestra/contracts';
import { siteSignature } from './site-signature';
import { WorldSpace } from './world-space';

const context = { murets: undefined, gardenStage: undefined, fullGarden: false, gardenKit: false, highlighted: false };

function village(): VillageState {
  const cells = [
    { id: 'hall', cellX: 100, cellY: 40, building: { id: 'b1', type: 'town-hall', status: 'completed', level: 2 } },
    { id: 'hall-east', cellX: 101, cellY: 40, footprint: { buildingId: 'b1', buildingType: 'town-hall' } },
    { id: 'empty', cellX: 103, cellY: 41, canBuild: true },
  ];
  return { world: { id: 'w' }, cells } as unknown as VillageState;
}

const projected = (state: VillageState, space: WorldSpace, anchor = { cellX: 100, cellY: 40 }): VillageCell[] =>
  state.cells.map((c) => ({ ...c, ...space.projectFrom(c, anchor) }));

it('keeps every site signature across a rebase of the local frame', () => {
  const state = village(),
    space = new WorldSpace(512, 256, { cellX: 96, cellY: 32 });
  const before = projected(state, space);
  expect(space.rebase({ cellX: 130, cellY: 70 }, 32)).not.toBeNull();
  const after = projected(state, space);
  expect(after[0]!.x).not.toBe(before[0]!.x);
  expect(after.map((site) => siteSignature(state, site, context))).toEqual(
    before.map((site) => siteSignature(state, site, context)),
  );
});

it('changes the signature of a site that moves to another cell or receives the garden kit', () => {
  const state = village(),
    site = state.cells[2]!;
  expect(siteSignature(state, { ...site, cellX: 104 }, context)).not.toBe(siteSignature(state, site, context));
  const garden = { ...site, building: { id: 'g', type: 'garden', status: 'completed', level: 1 } } as VillageCell;
  expect(siteSignature(state, garden, { ...context, gardenKit: true })).not.toBe(siteSignature(state, garden, context));
  expect(siteSignature(state, state.cells[0]!, { ...context, gardenKit: true })).toBe(
    siteSignature(state, state.cells[0]!, context),
  );
});
