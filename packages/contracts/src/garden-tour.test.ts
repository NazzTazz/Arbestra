import {expect,it} from 'vitest';
import {planGardenTour} from './garden-tour.js';
import type {TravelCell,TravelRoute} from './travel-paths.js';
const c=(x:number,y=0):TravelCell=>({cellX:x,cellY:y});
const route=(cells:TravelCell[]):TravelRoute=>({id:'route',kind:'garden',destination:cells[cells.length-1]!,cells});
it('visits the selected plots in order with sixty seconds each and one final return',()=>{
  const plan=planGardenTour([route([c(0),c(1),c(2)]),route([c(0),c(1),c(1,1)])],c(0),[c(2),c(1,1)])!;
  expect(plan.stops.map(s=>s.path)).toEqual([[c(0),c(1),c(2)],[c(2),c(1),c(1,1)]]);
  expect(plan.stops.map(s=>[s.arrivesAfterMs,s.workEndsAfterMs])).toEqual([[2000,62000],[64000,124000]]);
  expect(plan.returnPath).toEqual([c(1,1),c(1),c(0)]);expect(plan.durationMs).toBe(126000);
});
it('counts a canonical torus seam as one step and rejects a disconnected target',()=>{
  const routes=[route([c(7),c(0),c(1)])];
  expect(planGardenTour(routes,c(7),[c(0)])?.durationMs).toBe(62000);
  expect(planGardenTour(routes,c(7),[c(2)])).toBeNull();
});
it('crosses adjacent selected plots directly, including a torus seam, without shortcutting other land',()=>{
  const routes=[route([c(3),c(2),c(1),c(0)]),route([c(3),c(4),c(5),c(6),c(7)])];
  const plan=planGardenTour(routes,c(3),[c(0),c(7)],{widthCells:8,heightCells:4})!;
  expect(plan.stops[1]!.path).toEqual([c(0),c(7)]);
  expect(plan.stops[1]!.arrivesAfterMs-plan.stops[0]!.workEndsAfterMs).toBe(1000);
  expect(planGardenTour(routes,c(3),[c(0),c(7)])!.stops[1]!.path).toHaveLength(8);
});
