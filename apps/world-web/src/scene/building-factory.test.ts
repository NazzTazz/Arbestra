import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {Mesh} from '@babylonjs/core/Meshes/mesh';
import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {buildingPlan,HALL_RECIPE,HOUSE_RECIPE,type BuildingRecipe} from './building-plan';
import {TimberThatch,timberBeamGeometry} from './timber-thatch';
import {timberDoor} from './timber-door';
import {barracksPlan,buildBarracks} from './barracks-factory';

describe('Babylon building geometry',()=>{
  beforeAll(()=>vi.stubGlobal('OffscreenCanvas',class {
    width:number;height:number;
    constructor(width:number,height:number){this.width=width;this.height=height;}
    getContext(){return {fillRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},bezierCurveTo(){},ellipse(){},clearRect(){},drawImage(){},canvas:this};}
  }));
  afterAll(()=>vi.unstubAllGlobals());
  it('keeps the entire door thin and aligned after turning onto every facade',()=>{
    const engine=new NullEngine(),scene=new Scene(engine),kit=new TimberThatch(scene);
    try{
      for(const rotation of [0,Math.PI/2,Math.PI,-Math.PI/2]){
        const door=timberDoor(scene,kit.wood,.56,.82,timberBeamGeometry);door.rotation.y=rotation;door.computeWorldMatrix(true);
        const bounds=door.getBoundingInfo().boundingBox,size=bounds.maximumWorld.subtract(bounds.minimumWorld);
        const sideways=Math.abs(Math.sin(rotation))>.5;
        expect(sideways?size.z:size.x).toBeCloseTo(.554);
        expect(sideways?size.x:size.z).toBeLessThan(.08);
        expect(size.y).toBeCloseTo(.82);
        expect(scene.meshes).toHaveLength(1);
        door.dispose(false,false);expect(scene.meshes).toHaveLength(0);expect(scene.geometries).toHaveLength(0);
      }
    }finally{scene.dispose();engine.dispose();}
  });
  it('merges the finished hall and a works variant within bounded geometry, then releases both',()=>{
    const engine=new NullEngine(),scene=new Scene(engine),kit=new TimberThatch(scene);
    try{
      const make=(recipe:BuildingRecipe,phase:'finished'|'works')=>{
        const plan=buildingPlan({id:'test',anchor:{cellX:0,cellY:0},cells:recipe.id==='town-hall'?[{cellX:0,cellY:0},{cellX:0,cellY:1}]:[{cellX:0,cellY:0}],world:{widthCells:32,heightCells:32},recipe,phase,sourceLevels:phase==='works'?1:0});
        const root=new Mesh('factory-test',scene);kit.build(root,plan);return root;
      };
      const finished=make(HALL_RECIPE,'finished');
      const meshes=finished.getChildMeshes(),count=meshes.reduce((n,m)=>n+m.getTotalVertices(),0);
      expect(meshes.length).toBeLessThanOrEqual(5);expect(count).toBeLessThan(100_000);expect(count).toBeGreaterThan(20_000);
      const works=make({...HOUSE_RECIPE,levels:2},'works');
      expect(works.getChildMeshes().some(m=>m.material===kit.boards)).toBe(false);
      expect(works.getChildMeshes().reduce((n,m)=>n+m.getTotalVertices(),0)).toBeLessThan(count);
      expect(scene.meshes).toHaveLength(2+meshes.length+works.getChildMeshes().length);
      finished.dispose(false,false);works.dispose(false,false);expect(scene.meshes).toHaveLength(0);expect(scene.geometries).toHaveLength(0);
    }finally{scene.dispose();engine.dispose();}
  });
  it('builds two opposite pavilions with a 2×3 courtyard, covered tripod targets and bounded compound meshes',()=>{
    const plan=barracksPlan();expect(plan.pavilions).toHaveLength(2);expect(plan.court).toEqual({width:5,depth:7.5});
    expect(plan.pavilions.map(p=>p.z)).toEqual([-5,5]);
    expect(plan.pavilions[0]!.plan.entry.normal.x).toBe(-1);expect(plan.pavilions[1]!.plan.entry.normal.x).toBe(1);
    const engine=new NullEngine(),scene=new Scene(engine),kit=new TimberThatch(scene);
    try{const root=new Mesh('barracks-test',scene);buildBarracks(root,kit);
      const meshes=root.getChildMeshes().filter(m=>m.getTotalVertices()>0);
      expect(meshes.some(m=>m.name==='barracks-barracks-target-red')).toBe(true);
      expect(meshes.length).toBeLessThanOrEqual(16);expect(meshes.reduce((n,m)=>n+m.getTotalVertices(),0)).toBeLessThan(240_000);
      root.dispose(false,false);expect(scene.meshes).toHaveLength(0);expect(scene.geometries).toHaveLength(0);
      expect(scene.materials.some(m=>m.name==='barracks-target-red')).toBe(false);
      expect(scene.materials.some(m=>m.name==='barracks-packed-earth')).toBe(false);
    }finally{scene.dispose();engine.dispose();}
  });
});
