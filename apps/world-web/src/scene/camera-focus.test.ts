import {expect,it} from 'vitest';
import {cameraFocusAt} from './camera-focus';
it('glides across X, Y and the corner through the shortest torus displacement',()=>{
 expect(cameraFocusAt({cellX:511,cellY:20},{cellX:1,cellY:20},512,256,.5)).toMatchObject({cellX:0,cellY:20});
 expect(cameraFocusAt({cellX:20,cellY:255},{cellX:20,cellY:1},512,256,.5)).toMatchObject({cellX:20,cellY:0});
 expect(cameraFocusAt({cellX:511,cellY:255},{cellX:1,cellY:1},512,256,.5)).toMatchObject({cellX:0,cellY:0});
});
it('starts and ends exactly, with bounded easing for interrupted or reduced-motion frames',()=>{
 const from={cellX:5,cellY:7},to={cellX:10,cellY:15};
 expect(cameraFocusAt(from,to,512,256,-1)).toEqual({...from,eased:0});
 expect(cameraFocusAt(from,to,512,256,2)).toEqual({...to,eased:1});
 expect(cameraFocusAt(from,to,512,256,.25).eased).toBe(.15625);
});
