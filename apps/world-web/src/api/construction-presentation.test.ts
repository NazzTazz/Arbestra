import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { constructionConfirmationIsValid, type ConstructionConfirmation, type VillageState } from '@arbestra/contracts';
import { acceptConstructionPresentation, constructionPresentationState, currentConstructionPresentation } from './construction-presentation';

const base = JSON.parse(readFileSync(new URL('../../../../tests/fixtures/village-sync-state.json', import.meta.url), 'utf8')) as VillageState;
const confirmation = (revision = 2, serverTime = '2026-10-20T21:00:00.000Z'): ConstructionConfirmation => ({
  kind: 'construction', worldId: base.world.id, villageId: base.village.id,
  commandId: '55555555-5555-4555-8555-555555555555', commandTime: serverTime, serverTime, minimumRevision: revision,
  cells: base.cells.map(c => c.building?.type === 'dwelling' ? { ...c, building: { ...c.building, targetLevel: 2 } } : c),
  resources: base.village.resources.map(r => r.code === 'wood' ? { ...r, amount: r.amount - 25 } : r),
});

it('shows confirmed buildings and stocks while retaining the canonical revision and unrelated components', () => {
  const confirmed = confirmation();
  expect(constructionConfirmationIsValid(confirmed)).toBe(true);
  const shown = constructionPresentationState(base, confirmed)!;
  expect(shown.cells.find(c => c.building?.type === 'dwelling')?.building?.targetLevel).toBe(2);
  expect(shown.village.wood).toBe(base.village.wood - 25);
  expect(shown.syncRevision).toBe(base.syncRevision); expect(shown.serverTime).toBe(base.serverTime);
  expect(shown.travelRoutes).toBe(base.travelRoutes); expect(shown.village.population).toBe(base.village.population);
  expect(shown.cells.find(c => c.building?.type === 'town-hall')).toBe(base.cells.find(c => c.building?.type === 'town-hall'));
  expect(base.cells.find(c => c.building?.type === 'dwelling')?.building?.targetLevel).toBeNull();
});

it('keeps the confirmation through stale SSE and drops it only once its coherent projection is covered', () => {
  const confirmed = confirmation();
  expect(currentConstructionPresentation({ ...base, serverTime: '2026-10-20T22:00:00.000Z' }, confirmed)).toBe(confirmed);
  expect(currentConstructionPresentation({ ...base, syncRevision: 2, serverTime: '2026-10-20T20:59:59.000Z' }, confirmed)).toBe(confirmed);
  expect(currentConstructionPresentation({ ...base, syncRevision: 2, serverTime: confirmed.serverTime }, confirmed)).toBeNull();
  expect(currentConstructionPresentation({ ...base, syncRevision: 3 }, confirmed)).toBeNull();
});

it('orders successive confirmations and ignores duplicate, delayed, foreign and old-generation replies', () => {
  const first = confirmation(), second = confirmation(3);
  expect(acceptConstructionPresentation(base, null, first, 4, 4)).toBe(first);
  expect(acceptConstructionPresentation(base, first, second, 4, 4)).toBe(second);
  expect(acceptConstructionPresentation(base, second, first, 4, 4)).toBe(second);
  expect(acceptConstructionPresentation(base, first, first, 4, 4)).toBe(first);
  expect(acceptConstructionPresentation(base, first, second, 3, 4)).toBe(first);
  expect(acceptConstructionPresentation(base, first, {...second, villageId: second.commandId}, 4, 4)).toBe(first);
  expect(acceptConstructionPresentation({...base,syncRevision:4}, null, second, 4, 4)).toBeNull();
});

it('merges a footprint acknowledgement without removing the existing village',()=>{
  const full=confirmation(),house=full.cells.find(c=>c.building?.type==='dwelling')!;
  const patch={...full,cellsMode:'patch' as const,cells:[house]};
  const shown=constructionPresentationState(base,patch)!;
  expect(shown.cells).toHaveLength(base.cells.length);
  expect(shown.cells.find(c=>c.id===house.id)?.building?.targetLevel).toBe(2);
  for(const cell of base.cells.filter(c=>c.id!==house.id))expect(shown.cells.find(c=>c.id===cell.id)).toBe(cell);
});

it('keeps multiple acknowledged footprints through stale SSE, including reversed HTTP arrivals',()=>{
  const house=confirmation().cells.find(c=>c.building?.type==='dwelling')!;
  const first={...confirmation(),cellsMode:'patch' as const,cells:[house]};
  const added={...house,id:'66:64',cellX:66,x:5,building:{...house.building!,id:'66666666-6666-4666-8666-666666666666'}};
  const second={...confirmation(3,'2026-10-20T21:00:01.000Z'),cellsMode:'patch' as const,commandId:added.building.id,cells:[added]};
  for(const [earlier,later]of [[first,second],[second,first]] as const){
    const pending=acceptConstructionPresentation(base,earlier,later,4,4)!;
    expect(pending.minimumRevision).toBe(3);expect(pending.resources).toBe(second.resources);
    const shown=constructionPresentationState(base,pending)!;
    expect(shown.cells).toHaveLength(base.cells.length+1);
    expect(shown.cells.find(c=>c.id===house.id)?.building?.targetLevel).toBe(2);
    expect(shown.cells.find(c=>c.id===added.id)?.building?.id).toBe(added.building.id);
    expect(currentConstructionPresentation({...base,syncRevision:2,serverTime:second.serverTime},pending)).toBe(pending);
    expect(currentConstructionPresentation({...shown,syncRevision:3,serverTime:second.serverTime},pending)).toBeNull();
  }
});

it('orders stocks by their reading time when an older command reads its revision fence later',()=>{
  const older={...confirmation(5,'2026-10-20T21:00:00.000Z'),cellsMode:'patch' as const,cells:[confirmation().cells[1]!]};
  const newer={...confirmation(3,'2026-10-20T21:00:01.000Z'),cellsMode:'patch' as const,
    commandId:'66666666-6666-4666-8666-666666666666',cells:[],resources:older.resources.map(r=>({...r,amount:r.amount-25}))};
  for(const [prior,next]of [[older,newer],[newer,older]] as const){
    const pending=acceptConstructionPresentation(base,prior,next,4,4)!;
    expect(pending.resources).toBe(newer.resources);
    expect(pending.serverTime).toBe(newer.serverTime);
    expect(pending.minimumRevision).toBe(5);
    expect(pending.cells).toEqual(older.cells);
  }
});
