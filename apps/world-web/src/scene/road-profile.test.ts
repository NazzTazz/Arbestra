import {expect,it} from 'vitest';
import {emptyInfrastructure,type VillageState} from '@arbestra/contracts';
import {villageRoadDisplayRoutes} from './road-profile';

it('does not reserve invisible automatic road strips across manually painted work areas',()=>{
  const infrastructure=emptyInfrastructure();
  infrastructure.roads=[{id:'paving',operation:'paint',material:'stone-1',width:4,border:false,points:[{x:8,y:8},{x:24,y:8}]}];
  const state={world:{widthCells:16,heightCells:16},infrastructure,
    cells:[{cellX:0,cellY:1,footprint:{buildingId:'hall'}},{cellX:4,cellY:1,footprint:{buildingId:'house'}}],
    travelRoutes:[{id:'house',kind:'building',destination:{cellX:4,cellY:1},cells:Array.from({length:5},(_,cellX)=>({cellX,cellY:1}))}]} as unknown as VillageState;
  expect(villageRoadDisplayRoutes({...state,infrastructure:emptyInfrastructure()})[0]?.cells).toEqual([{cellX:1,cellY:1},{cellX:2,cellY:1},{cellX:3,cellY:1}]);
  expect(villageRoadDisplayRoutes(state)).toEqual([]);
});
