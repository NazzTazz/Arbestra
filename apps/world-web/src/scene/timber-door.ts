import {Mesh} from '@babylonjs/core/Meshes/mesh';
import {Vector3,Quaternion} from '@babylonjs/core/Maths/math.vector';
import type {VertexData} from '@babylonjs/core/Meshes/mesh.vertexData';
import type {Scene} from '@babylonjs/core/scene';
import type {StandardMaterial} from '@babylonjs/core/Materials/standardMaterial';

/** Atomic door in its own frame: X across, Y up, +Z outside, origin at the sill. */
export function timberDoor(scene:Scene,material:StandardMaterial,width:number,height:number,
  geometry:(length:number,width:number,depth:number)=>VertexData):Mesh {
  const pieces:Mesh[]=[],point=(x:number,y:number,z:number)=>new Vector3(x,y,z);
  const beam=(name:string,a:Vector3,b:Vector3,w:number,d:number)=>{
    const mesh=new Mesh(name,scene);geometry(Vector3.Distance(a,b),w,d).applyToMesh(mesh);
    mesh.material=material;mesh.position=Vector3.Center(a,b);mesh.rotationQuaternion=new Quaternion();
    Quaternion.FromUnitVectorsToRef(Vector3.Up(),b.subtract(a).normalize(),mesh.rotationQuaternion);
    pieces.push(mesh);
  };
  const count=Math.ceil(width/.11),step=width/count;
  for(let i=0;i<count;i++){const x=-width/2+(i+.5)*step;beam('door-plank',point(x,0,0),point(x,height,0),step-.006,.038);}
  const inset=Math.min(.07,height/5),left=-width/2+.03,right=width/2-.03;
  for(const y of [inset,height-inset])beam('door-rail',point(left,y,.0365),point(right,y,.0365),.06,.035);
  beam('door-z',point(left,inset,.0365),point(right,height-inset,.0365),.05,.035);
  const door=Mesh.MergeMeshes(pieces,true,true);
  if(!door)throw new Error('Door geometry merge failed');
  door.name='timber-door';door.material=material;return door;
}
