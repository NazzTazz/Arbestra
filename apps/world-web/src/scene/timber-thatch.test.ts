import { expect,it } from 'vitest';
import { hallWallCourse,hallStoneCrossRotation,timberBeamGeometry,timberFrameGeometry,stoneBlockGeometry,compactTimberBeamGeometry } from './timber-thatch';
import { Matrix,Quaternion,Vector3 } from '@babylonjs/core/Maths/math.vector';
it('keeps chamfered timber bounds and exterior normals within 48 vertices',()=>{
  for(const length of [3.16,.012]){
    const data=compactTimberBeamGeometry(length,.22,.20),positions=data.positions!,normals=data.normals!;
    expect(positions.length/3).toBeLessThanOrEqual(48);
    for(const [axis,size] of [[0,.22],[1,length],[2,.20]]){
      const values=Array.from({length:positions.length/3},(_,i)=>positions[i*3+axis!]!);
      expect(Math.max(...values)-Math.min(...values)).toBeCloseTo(size!,6);
    }
    for(let i=0;i<positions.length;i+=3)expect(positions[i]!*normals[i]!+positions[i+1]!*normals[i+1]!+positions[i+2]!*normals[i+2]!).toBeGreaterThan(0);
  }
});
it('keeps lightweight masonry bounds and exterior normals, including narrow opening cuts',()=>{
  for(const length of [.29,.012]){
    const data=stoneBlockGeometry(length,.137,.16),positions=data.positions!,normals=data.normals!;
    expect(positions.length/3).toBeLessThanOrEqual(24);
    const span=(axis:number)=>{const values=Array.from({length:positions.length/3},(_,i)=>positions[i*3+axis]!);return Math.max(...values)-Math.min(...values);};
    expect(span(0)).toBeCloseTo(.137,6);expect(span(1)).toBeCloseTo(length,6);expect(span(2)).toBeCloseTo(.16,6);
    for(let i=0;i<positions.length;i+=3)expect(positions[i]!*normals[i]!+positions[i+1]!*normals[i+1]!+positions[i+2]!*normals[i+2]!).toBeGreaterThan(0);
  }
});
it('keeps raw frame members circular, at their bearing height, with exterior normals',()=>{
  for(const height of [.153,.2,.075,.035]){
    const geometry=timberFrameGeometry(2,.123,height,true),positions=geometry.positions!,normals=geometry.normals!;
    for(let i=0;i<positions.length;i+=3){
      const radius=Math.hypot(positions[i]!,positions[i+2]!);
      if(radius>1e-6)expect(radius).toBeCloseTo(height/2,6);
      expect(Math.abs(positions[i+1]!)).toBeLessThanOrEqual(1);
      expect(positions[i]!*normals[i]!+positions[i+1]!*normals[i+1]!+positions[i+2]!*normals[i+2]!).toBeGreaterThan(0);
    }
  }
});

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
