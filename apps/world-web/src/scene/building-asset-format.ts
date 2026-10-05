type SerializedGeometry = {id:string;[key:string]:unknown};
export interface BakedScene {geometries?:{vertexData?:SerializedGeometry[]};[key:string]:unknown}
const attributes=['positions','normals','uvs','uvs2','uvs3','uvs4','uvs5','uvs6','colors','indices'];
interface BufferRef {offset:number;length:number;integer:boolean}

/** AB01: padded JSON hierarchy/materials followed by aligned Float32/Uint32 buffers. */
export function encodeBuildingAsset(scene:BakedScene):Uint8Array {
  const arrays:Array<Float32Array|Uint32Array>=[];let offset=0;
  for(const geometry of scene.geometries?.vertexData??[])for(const key of attributes){
    const values=geometry[key];if(!Array.isArray(values)&&!ArrayBuffer.isView(values))continue;
    const integer=key==='indices';const array=integer?new Uint32Array(values as number[]):new Float32Array(values as number[]);
    geometry[key]={offset,length:array.length,integer};arrays.push(array);offset+=array.byteLength;
  }
  const json=new TextEncoder().encode(JSON.stringify(scene)),start=8+Math.ceil(json.length/4)*4;
  const bytes=new Uint8Array(start+offset),header=new DataView(bytes.buffer);
  header.setUint32(0,0x41423031);header.setUint32(4,json.length,true);bytes.set(json,8);
  let cursor=start;for(const array of arrays){bytes.set(new Uint8Array(array.buffer),cursor);cursor+=array.byteLength;}
  return bytes;
}

export function decodeBuildingAsset(buffer:ArrayBuffer):BakedScene {
  const header=new DataView(buffer);
  if(buffer.byteLength<8||header.getUint32(0)!==0x41423031)throw new Error('Invalid building asset format');
  const size=header.getUint32(4,true),start=8+Math.ceil(size/4)*4;
  if(start>buffer.byteLength)throw new Error('Truncated building asset');
  const scene=JSON.parse(new TextDecoder().decode(new Uint8Array(buffer,8,size))) as BakedScene;
  for(const geometry of scene.geometries?.vertexData??[])for(const key of attributes){
    const ref=geometry[key] as BufferRef|undefined;if(!ref)continue;
    if(!Number.isSafeInteger(ref.offset)||!Number.isSafeInteger(ref.length)||ref.offset<0||ref.length<0||start+ref.offset+ref.length*4>buffer.byteLength)throw new Error('Invalid building geometry buffer');
    geometry[key]=ref.integer?new Uint32Array(buffer,start+ref.offset,ref.length):new Float32Array(buffer,start+ref.offset,ref.length);
  }
  return scene;
}
