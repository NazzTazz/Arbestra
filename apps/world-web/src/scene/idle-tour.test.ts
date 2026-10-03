import {expect,it} from 'vitest';
import {idleTour,idleTourPhase} from './idle-tour';
const hall={x:0,z:0},porch={x:0,z:-1},road={x:2,z:-1};
const visits=[{buildingId:'hall',path:[hall]},{buildingId:'a',path:[hall,porch,road,{x:2,z:3}]},{buildingId:'b',path:[hall,porch,road,{x:4,z:3}]}];
it('joins houses on their common street, includes door endpoints and never crosses the hall interior',()=>{
  const tour=idleTour(visits,'representative');expect(tour).toHaveLength(3);
  const houses=tour.find(l=>l.from!=='hall'&&l.to!=='hall')!;
  expect(houses.path).not.toContainEqual(hall);expect(houses.path).toContainEqual(road);
  expect(houses.path[0]).toEqual(visits.find(v=>v.buildingId===houses.from)!.path.at(-1));
  expect(houses.path.at(-1)).toEqual(visits.find(v=>v.buildingId===houses.to)!.path.at(-1));
  expect(idleTour(visits,'representative')).toEqual(tour);
});
it('has deterministic walking and indoor phases and declines an unsafe house-to-house connection',()=>{
  const tour=idleTour(visits,'representative'),duration=tour.reduce((n,l)=>n+l.walkMs+l.insideMs,0);
  const first=idleTourPhase(tour,123456,'representative'),next=idleTourPhase(tour,123456+duration,'representative');
  expect([first.leg,first.inside,first.progress]).toEqual([next.leg,next.inside,next.progress]);
  expect(next.nextAt-first.nextAt).toBeCloseTo(duration,6);
  let inside=false,outside=false;for(let t=0;t<duration;t+=1000){const p=idleTourPhase(tour,t,'representative');inside ||=p.inside;outside ||=!p.inside;}
  expect(inside&&outside).toBe(true);
  expect(idleTour([{buildingId:'a',path:[hall,{x:1,z:1}]},{buildingId:'b',path:[hall,{x:-1,z:1}]}],'key')).toEqual([]);
  expect(idleTour([visits[0]!],'key')).toEqual([]);
});
