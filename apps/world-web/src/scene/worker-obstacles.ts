import type {NaturalFeature,VillageState} from '@arbestra/contracts';
import type {WorldSpace} from './world-space';

type Obstacles=Pick<VillageState,'cells'|'region'>;

/** Presentation-only obstacles, using the accepted village snapshot. */
export class WorkerObstacles{
  #cells:Obstacles['cells']|null=null;
  #features:Obstacles['region']['features']|null=null;
  readonly #occupied=new Set<string>();
  readonly #blocking=new Map<string,string[]>();
  readonly #byId=new Map<string,NaturalFeature>();
  #equipment:readonly {x:number;y:number}[]|null=null;
  #space:WorldSpace|null=null;
  #spaceVersion=-1;
  readonly #equipmentCells=new Map<string,{x:number;z:number}[]>();
  updateEquipment(equipment:readonly {x:number;y:number}[],space:WorldSpace):void{
    if(equipment===this.#equipment&&space===this.#space&&space.version===this.#spaceVersion)return;
    this.#equipment=equipment;this.#space=space;this.#spaceVersion=space.version;this.#equipmentCells.clear();
    for(const item of equipment){
      const p=space.project({cellX:item.x/8,cellY:item.y/8}),key=`${Math.floor(p.x)}:${Math.floor(p.z)}`;
      const cell=this.#equipmentCells.get(key);
      if(cell)cell.push(p);else this.#equipmentCells.set(key,[p]);
    }
  }
  equipmentBlocked(point:{x:number;z:number},radius:number):boolean{
    const reach=radius+.23;
    for(let x=Math.floor(point.x-reach);x<=Math.floor(point.x+reach);x++)
      for(let z=Math.floor(point.z-reach);z<=Math.floor(point.z+reach);z++)
        for(const p of this.#equipmentCells.get(`${x}:${z}`)??[])
          if(Math.hypot(point.x-p.x,point.z-p.z)<reach)return true;
    return false;
  }
  update(state:Obstacles):void{
    if(state.cells!==this.#cells){
      this.#cells=state.cells;this.#occupied.clear();
      for(const c of state.cells)if(c.footprint||c.building)this.#occupied.add(`${c.cellX}:${c.cellY}`);
    }
    if(state.region.features!==this.#features){
      this.#features=state.region.features;this.#blocking.clear();this.#byId.clear();
      for(const f of state.region.features){
        if(!this.#byId.has(f.id))this.#byId.set(f.id,f);
        if(f.deposit?.blocksCell===false||f.deposit?.cleared===true)continue;
        const key=`${f.cellX}:${f.cellY}`,ids=this.#blocking.get(key);
        if(ids)ids.push(f.id);else this.#blocking.set(key,[f.id]);
      }
    }
  }
  blocked(x:number,y:number,ownFeatureId:string|null):boolean{
    const key=`${x}:${y}`;
    return this.#occupied.has(key)||(this.#blocking.get(key)?.some(id=>id!==ownFeatureId)??false);
  }
  feature(id:string|null):NaturalFeature|undefined{return id===null?undefined:this.#byId.get(id);}
}
