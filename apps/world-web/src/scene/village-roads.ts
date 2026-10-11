import {automaticRoadStrokes,emptyInfrastructure,type TravelCell,type TravelRoute,type InfrastructurePlan} from '@arbestra/contracts';
import type {Scene} from '@babylonjs/core/scene';
import type {WorldSpace} from './world-space';
import {InfrastructureRenderer} from './infrastructure-renderer';
export {roadEdges} from './road-profile';

/** Automatic decoration shares the manual road masonry and sidewalk renderer. */
export class VillageRoads {
 readonly #renderer:InfrastructureRenderer;
 #routeSignature='';#requestSignature='';#revision=0;#plan:InfrastructurePlan=emptyInfrastructure();#alpha=1;
 constructor(scene:Scene){this.#renderer=new InfrastructureRenderer(scene);}
 update(signature:string,routes:readonly TravelRoute[],space:WorldSpace,ground:(cell:TravelCell)=>{code:number;height:number}|null,followTerrain=false):void{
  if(signature===this.#requestSignature)return;this.#requestSignature=signature;
  const routeSignature=JSON.stringify([space.width,space.height,routes.map(r=>r.cells)]);
  if(routeSignature!==this.#routeSignature){this.#routeSignature=routeSignature;this.#plan={...emptyInfrastructure(),roads:automaticRoadStrokes(routes,{widthCells:space.width,heightCells:space.height})};}
  this.#renderer.update(this.#plan,space,(x,y)=>{const g=ground({cellX:x,cellY:y});return g?.code===1?g.height:null;},false,++this.#revision,undefined,false,[],{followTerrain});
  for(const mesh of this.#renderer.meshes)mesh.name=mesh.material?.name==='infrastructure-border'?'village-road-curbs':'village-road-paved';
  this.show(this.#alpha);
 }
 show(alpha:number):void{this.#alpha=alpha;for(const mesh of this.#renderer.meshes){mesh.visibility=alpha;mesh.setEnabled(alpha>0);}}
 dispose():void{this.#renderer.dispose();}
}
