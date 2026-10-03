import { expect,it } from 'vitest';
import { hallWallCourse,hallStoneCrossRotation,timberBeamGeometry } from './timber-thatch';
import { Matrix,Quaternion,Vector3 } from '@babylonjs/core/Maths/math.vector';

it('keeps stone height and wall thickness consistent on front and side walls',()=>{
  for(const axis of ['x','z'] as const){
    const base=new Quaternion();Quaternion.FromUnitVectorsToRef(Vector3.Up(),axis==='x'?Vector3.Right():Vector3.Forward(),base);
    const matrix=Matrix.Compose(Vector3.One(),hallStoneCrossRotation(axis).multiply(base),Vector3.Zero());
    const geometry=timberBeamGeometry(.29,.137,.16,true),positions=geometry.positions!;
    const points=Array.from({length:positions.length/3},(_,i)=>Vector3.TransformCoordinates(Vector3.FromArray(positions,i*3),matrix));
    const range=(key:'x'|'y'|'z')=>Math.max(...points.map(p=>p[key]))-Math.min(...points.map(p=>p[key]));
    expect(range('y')).toBeCloseTo(.137,6);
    expect(range(axis==='x'?'z':'x')).toBeCloseTo(.16,6);
  }
});

it('bonds all four corners without gaps or overlapping walls on alternating courses',()=>{
  for(const row of [0,1,2,3]){
    const front=hallWallCourse(row,'x'),side=hallWallCourse(row,'z');
    for(const sx of [-1,1])for(const sz of [-1,1]){
      for(const inset of [.01,.12]){
        const x=sx*(1.245-inset),z=sz*(1.135-inset);
        const frontContains=Math.abs(x)<front.limit&&Math.abs(z-sz*front.fixed)<front.thickness/2;
        const sideContains=Math.abs(z)<side.limit&&Math.abs(x-sx*side.fixed)<side.thickness/2;
        expect(Number(frontContains)+Number(sideContains),`corner ${sx}/${sz} row ${row}`).toBe(1);
      }
    }
  }
});

it.each([
  {name:'ridge purlin',length:3.16,width:.22,height:.20,rounded:false},
  {name:'rounded stone',length:.29,width:.14,height:.16,rounded:true},
  {name:'short stone beside an opening',length:.012,width:.14,height:.16,rounded:true},
])('keeps exterior lighting normals on $name',({length,width,height,rounded})=>{
  const geometry=timberBeamGeometry(length,width,height,rounded);
  const positions=geometry.positions!,normals=geometry.normals!,indices=geometry.indices!;
  for(let i=0;i<indices.length;i+=3){
    let outward=0;
    for(let k=0;k<3;k++){const vertex=indices[i+k]!*3;
      outward+=positions[vertex]!*normals[vertex]!+positions[vertex+1]!*normals[vertex+1]!+positions[vertex+2]!*normals[vertex+2]!;}
    expect(outward,`exterior normal of triangle ${i/3}`).toBeGreaterThan(0);
  }
});
