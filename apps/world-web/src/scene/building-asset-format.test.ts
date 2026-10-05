import {expect,it} from 'vitest';
import {encodeBuildingAsset,decodeBuildingAsset} from './building-asset-format';

it('roundtrips indexed geometry as binary buffers while retaining hierarchy and attachments',()=>{
  const bytes=encodeBuildingAsset({meshes:[{name:'window',metadata:{buildingAttachment:'glass'}}],geometries:{vertexData:[{id:'shape',positions:[1.25,2,3,4,5,6,7,8,9],normals:[0,1,0,0,1,0,0,1,0],indices:[0,1,2]}]}});
  const result=decodeBuildingAsset(bytes.buffer as ArrayBuffer),geometry=result.geometries!.vertexData![0]!;
  expect(geometry.positions).toBeInstanceOf(Float32Array);expect(geometry.indices).toBeInstanceOf(Uint32Array);
  expect(Array.from(geometry.positions as Float32Array)).toEqual([1.25,2,3,4,5,6,7,8,9]);
  expect(result.meshes).toEqual([{name:'window',metadata:{buildingAttachment:'glass'}}]);
  expect(()=>decodeBuildingAsset(bytes.buffer.slice(0,-4) as ArrayBuffer)).toThrow('Invalid building geometry buffer');
  expect(()=>decodeBuildingAsset(new ArrayBuffer(8))).toThrow('Invalid building asset format');
});
