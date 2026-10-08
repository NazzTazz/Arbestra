import { expect,it } from 'vitest';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { torusFrame } from '@arbestra/contracts/cosmology';
import { torusTreeMatrix } from './world-tree-transform';
it('roots trees on the actual displaced torus, including its inner and underside faces',()=>{
 for(const x of [0,64,128,255])for(const y of [0,32,64,96])for(const amplification of [1,4])for(const size of [.65,1.5]){
  const frame=torusFrame(x/256*Math.PI*2,y/128*Math.PI*2+Math.PI),normal=Vector3.FromArray([...frame.normal]);
  const matrix=torusTreeMatrix(x,y,1,.35,256,128,amplification,size,1.2);
  const base=Vector3.TransformCoordinates(new Vector3(0,-.35,0),matrix),expected=Vector3.FromArray([...frame.point]).add(normal.scale(amplification*Math.PI*2/128));
  expect(Vector3.Distance(base,expected)).toBeLessThan(1e-6);
  expect(Vector3.Dot(Vector3.TransformNormal(Vector3.Up(),matrix).normalize(),normal)).toBeCloseTo(1,6);
 }
});
