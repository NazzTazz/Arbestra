import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Vector3, Quaternion } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { TimberThatch, timberBeamGeometry } from './timber-thatch';
import { BuildingGeometry } from './building-geometry';

/** Three factory half-trusses supporting an open, dark wooden slat canopy. */
export function buildMarketRoof(root:Mesh,kit:TimberThatch,eave:number,finished:boolean) {
  const outer=-1.20,inner=-.38,low=eave-.12,high=eave;
  const frame:Mesh[]=[],slats:Mesh[]=[];
  const beam=(name:string,p:Vector3,q:Vector3,width:number,height:number,parts=frame)=>{
    const mesh=new Mesh(name,kit.scene);
    (kit.lod?BuildingGeometry.box(name,{height:Vector3.Distance(p,q),width,depth:height}).data:timberBeamGeometry(Vector3.Distance(p,q),width,height,false,3,.02)).applyToMesh(mesh);
    mesh.position=Vector3.Center(p,q);mesh.rotationQuaternion=new Quaternion();
    Quaternion.FromUnitVectorsToRef(Vector3.Up(),q.subtract(p).normalize(),mesh.rotationQuaternion);parts.push(mesh);
  };
  for(const z of [-2.17,0,2.17]){
    beam('market-half-truss-tie',new Vector3(outer,low,z),new Vector3(inner,low,z),.07,.085);
    beam('market-half-truss-rafter',new Vector3(outer,low,z),new Vector3(inner,high,z),.07,.085);
    beam('market-half-truss-post',new Vector3(inner,low,z),new Vector3(inner,high,z),.07,.085);
    beam('market-half-truss-strut',new Vector3(inner,low,z),new Vector3((outer+inner)/2,(low+high)/2,z),.045,.045);
  }
  for(const [x,y] of [[outer,low],[inner,high]])beam('market-canopy-purlin',new Vector3(x,y,-2.35),new Vector3(x,y,2.35),.07,.07);
  const frameWood=new StandardMaterial('market-frame-dark-wood',kit.scene);frameWood.diffuseTexture=kit.wood.diffuseTexture;frameWood.diffuseColor=Color3.FromHexString('#765239');frameWood.specularColor=Color3.Black();
  root.onDisposeObservable.addOnce(()=>frameWood.dispose());
  const merged=Mesh.MergeMeshes(frame,true,true);if(merged){merged.parent=root;merged.material=frameWood;merged.receiveShadows=true;}
  if(!finished)return;
  const dark=new StandardMaterial('market-dark-wood-slats',kit.scene);dark.diffuseTexture=kit.wood.diffuseTexture;dark.diffuseColor=Color3.FromHexString('#211c19');dark.specularColor=Color3.Black();
  for(let z=-2.35;z<=2.35;z+=.09){
    beam('market-dark-roof-slat',new Vector3(outer,low+.075,z),new Vector3(inner,high+.075,z),.035,.065,slats);
  }
  const cover=Mesh.MergeMeshes(slats,true,true);if(cover){cover.name='market-dark-roof-slats';cover.parent=root;cover.material=dark;cover.receiveShadows=true;}
  root.onDisposeObservable.addOnce(()=>dark.dispose());
}
