import { expect, it } from 'vitest';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { walkOnPlane } from './inhabitant-camera';

it('cannot cross a thin obstacle even with a long movement and slides along its edge',()=>{
  const free=(x:number)=>x<1||x>1.2;
  const result=walkOnPlane(Vector3.Zero(),3,0,free);
  expect(result.x).toBeLessThan(1);
  const along=walkOnPlane(result,1,2,free);
  expect(along.x).toBeLessThan(1);expect(along.z).toBeCloseTo(2);
  const noclip=walkOnPlane(Vector3.Zero(),3,0,()=>true);
  expect(noclip.x).toBeCloseTo(3);
});
