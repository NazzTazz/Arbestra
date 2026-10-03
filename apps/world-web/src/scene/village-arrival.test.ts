import { expect, it } from 'vitest';
import { arrivalFrame, landingPose, townHallFocus, VILLAGE_LANDING } from './village-arrival';
import type { VillageState } from '@arbestra/contracts';
it('lands at the town hall footprint centre across the seam, not the village anchor',()=>{
  const state={world:{widthCells:64,heightCells:64},village:{anchorCellX:20,anchorCellY:20},cells:[
    {cellX:63,cellY:4,building:{id:'hall',type:'town-hall'},footprint:{buildingId:'hall'}},
    {cellX:0,cellY:4,building:null,footprint:{buildingId:'hall'}},
    {cellX:20,cellY:20,building:{id:'house',type:'house'},footprint:{buildingId:'house'}},
  ]} as unknown as VillageState;
  expect(townHallFocus(state)).toEqual({cellX:63.5,cellY:4});
});
it('titles a black frame, restores current light over three seconds, then removes the title and fine blur', () => {
  expect(arrivalFrame(450, false).black).toBe(.5);
  expect(arrivalFrame(450, false).title).toBe(0);
  expect(arrivalFrame(1000, false).title).toBe(1);
  expect(arrivalFrame(1000, false).black).toBe(.5);
  expect(arrivalFrame(1900, false).black).toBe(0);
  expect(arrivalFrame(1200, false).light).toBeCloseTo(.08);
  expect(arrivalFrame(2700, false).light).toBeCloseTo(.54);
  expect(arrivalFrame(4200, false).light).toBe(1);
  expect(arrivalFrame(4200, false).title).toBe(1);
  expect(arrivalFrame(4900, false).title).toBe(0);
  expect(arrivalFrame(4900, false).veil).toBeGreaterThan(0);
  expect(arrivalFrame(5200, false)).toEqual({ veil: 0, black: 0, title: 0, light: 1, done: true });
  expect(arrivalFrame(1200, true)).toEqual({ veil: 0, black: 0, title: 0, light: 1, done: true });
});
it('lands continuously, approaching before lowering the viewing angle and focal length', () => {
  const from = { radius: 260, beta: .3, fov: .85 };
  expect(landingPose(from, 0, false)).toEqual(from);
  expect(landingPose(from, 500, false).radius).toBeLessThan(from.radius);
  expect(landingPose(from, 500, false).beta).toBe(from.beta);
  let last = from;
  for (let time = 50; time <= 5200; time += 50) {
    const pose = landingPose(from, time, false);
    expect(pose.radius).toBeLessThanOrEqual(last.radius);
    expect(pose.radius * Math.cos(pose.beta)).toBeLessThanOrEqual(last.radius * Math.cos(last.beta));
    last = pose;
  }
  expect(last.radius).toBe(VILLAGE_LANDING.radius);
  expect(last.beta).toBe(VILLAGE_LANDING.beta);
  expect(last.fov).toBeCloseTo(VILLAGE_LANDING.fov);
  expect(landingPose(from, 0, true)).toEqual(VILLAGE_LANDING);
});
