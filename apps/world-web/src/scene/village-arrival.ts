import type { VillageState, TravelCell } from '@arbestra/contracts';
import { delta, normalize } from './world-space';
import { planForSite, planFocus } from './building-plan';
export function townHallFocus(state: VillageState): TravelCell {
  const hall=state.cells.find(c=>c.building?.type==='town-hall');
  if(!hall) return {cellX:state.village.anchorCellX,cellY:state.village.anchorCellY};
  const plan=planForSite(state,hall);if(plan)return planFocus(state,hall,plan);
  const cells=state.cells.filter(c=>c.footprint?.buildingId===hall.building!.id);
  if(!cells.length) return hall;
  return {cellX:normalize(hall.cellX+cells.reduce((s,c)=>s+delta(c.cellX,hall.cellX,state.world.widthCells),0)/cells.length,state.world.widthCells),
    cellY:normalize(hall.cellY+cells.reduce((s,c)=>s+delta(c.cellY,hall.cellY,state.world.heightCells),0)/cells.length,state.world.heightCells)};
}
export interface VillageArrival { name: string; time: string; veil: number; black: number; title: number }
export interface LandingPose { radius: number; beta: number; fov: number }
const ramp = (value: number) => Math.max(0, Math.min(1, value));
const ease = (value: number) => { const t = ramp(value); return t * t * (3 - 2 * t); };
export const VILLAGE_LANDING: LandingPose = { radius: 36, beta: 1, fov: .501 };
export function landingPose(from: LandingPose, elapsed: number, reduced: boolean): LandingPose {
  if (reduced) return VILLAGE_LANDING;
  const zoom = ease(elapsed / 4200), descend = ease((elapsed - 1000) / 4200);
  return { radius: from.radius + (VILLAGE_LANDING.radius - from.radius) * zoom,
    beta: from.beta + (VILLAGE_LANDING.beta - from.beta) * descend,
    fov: from.fov + (VILLAGE_LANDING.fov - from.fov) * descend };
}
export function arrivalFrame(elapsed: number, reduced: boolean) {
  if (reduced) return { veil: 0, black: .5 * ramp((1200 - elapsed) / 300),
    title: ramp((1000 - elapsed) / 200), light: 1, done: elapsed >= 1200 };
  // Black first, title on black, landscape reveal, three seconds to current light,
  // then the title leaves. This multiplier never pauses the astronomical clock.
  const black = .5 * Math.min(ease(elapsed / 450), 1 - ease((elapsed - 1200) / 700));
  const veil = ease((elapsed - 1200) / 700) * (1 - ease((elapsed - 4800) / 400));
  const title = ease((elapsed - 450) / 450) * (1 - ease((elapsed - 4200) / 700));
  const light = 1 - .92 * ease(elapsed / 400) * (1 - ease((elapsed - 1200) / 3000));
  return { veil, black, title, light, done: elapsed >= 5200 };
}
