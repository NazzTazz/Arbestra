import { describe, expect, it } from 'vitest';
import { stairProfile } from './stair-profile';
import type { NaturalStair } from '@arbestra/contracts';
describe('wide shallow natural stairs',()=>{
  it.each([0,1] as const)('connects both plateau heights on axis %s in either ascent direction',direction=>{
    for(const [first,last]of [[1,2],[2,1]]){
      const s:NaturalStair={x:7,y:2,direction,length:2,width:4,low:1,high:2,from:0,to:1};
      const steps=stairProfile(s,{elevations:[first!,last!]});
      expect(steps).toHaveLength(8);expect(steps[0]!.a).toBe(0);expect(steps.at(-1)!.b).toBe(2);
      expect(steps[0]!.near).toBe(first);expect(steps.at(-1)!.far).toBe(last);
      for(const t of steps){
        expect(t.b-t.a).toBe(.25);expect(s.width/(t.b-t.a)).toBe(16);
        expect(t.height).toBeGreaterThanOrEqual(1);expect(t.height).toBeLessThanOrEqual(2);
        if(last!>first!){expect(t.riserAt).toBe(t.a);expect(t.height).toBe(t.far);}
        else{expect(t.riserAt).toBe(t.b);expect(t.height).toBe(t.near);}
      }
      for(let k=1;k<steps.length;k++)expect(steps[k]!.near).toBe(steps[k-1]!.far);
    }
  });
});
