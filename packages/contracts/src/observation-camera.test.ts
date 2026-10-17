import {expect,it} from 'vitest';
import {interpolateObservationPose} from './observation-camera.js';
import type {ObservationPose} from './observation.js';
const base={mode:'village' as const,cellX:511,cellY:255,alpha:Math.PI*2-.1,beta:.8,radius:20,altitude:1,fov:.55};
it('interpolates camera motion over both seams and the angle wrap',()=>{const pose=interpolateObservationPose(base,{...base,cellX:1,cellY:1,alpha:.1},{widthCells:512,heightCells:256},.5);expect(pose).toMatchObject({cellX:0,cellY:0});expect('alpha'in pose&&Math.min(pose.alpha,Math.abs(pose.alpha-Math.PI*2))).toBeCloseTo(0,8);});
it('does not interpolate incompatible camera frames',()=>{const target:ObservationPose={mode:'world',eye:[0,0,10],target:[0,0,0],up:[0,1,0],fov:.55};expect(interpolateObservationPose(base,target,{widthCells:512,heightCells:256},.2)).toEqual(target);});
