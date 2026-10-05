import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {Mesh} from '@babylonjs/core/Meshes/mesh';
import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {buildingPlan,HALL_RECIPE,HOUSE_RECIPE,type BuildingRecipe} from './building-plan';
import {TimberThatch,timberBeamGeometry} from './timber-thatch';
import {timberDoor} from './timber-door';
import {barracksPlan,buildBarracks} from './barracks-factory';
import {buildInfrastructurePresentation} from './infrastructure-factory';

describe('Babylon building geometry',()=>{
  beforeAll(()=>vi.stubGlobal('OffscreenCanvas',class {
    width:number;height:number;
    constructor(width:number,height:number){this.width=width;this.height=height;}
    getContext(){return {fillRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},bezierCurveTo(){},ellipse(){},clearRect(){},drawImage(){},canvas:this};}
  }));
  afterAll(()=>vi.unstubAllGlobals());
  it('builds the infrastructure door fixture with a real house touching the road, then releases its resources',()=>{
    const engine=new NullEngine(),scene=new Scene(engine);
    try{
      const root=buildInfrastructurePresentation(scene,{fixture:'door',material:'stone-1',width:4,border:true,quarterTurns:0,length:2});
      const building=root.getChildMeshes().find(m=>m.name==='door-fixture')!;expect(building).toBeDefined();
      const body=building.getChildMeshes();expect(body.reduce((n,m)=>n+m.getTotalVertices(),0)).toBeGreaterThan(10_000);
      expect(building.position.x).toBeCloseTo(HOUSE_RECIPE.modules![0]*HOUSE_RECIPE.module.length/2);
      expect(root.getChildMeshes().some(m=>m.name==='infrastructure-stone-1')).toBe(true);
      root.dispose(false,false);expect(scene.meshes).toHaveLength(0);expect(scene.geometries).toHaveLength(0);expect(scene.materials).toHaveLength(0);
    }finally{scene.dispose();engine.dispose();}
  });
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
      const uploads=vi.spyOn(engine,'createVertexBuffer');
      const finished=make(HALL_RECIPE,'finished');
      // Only final material batches should reach the GPU, never individual stones/planks.
      expect(uploads.mock.calls.length).toBeLessThanOrEqual(25);
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
  it('yields campus-style construction without uploading temporary geometry and cancels disposed roots',()=>{
    const engine=new NullEngine(),scene=new Scene(engine),kit=new TimberThatch(scene);
    try{
      const plan=buildingPlan({id:'chunked',anchor:{cellX:0,cellY:0},cells:[{cellX:0,cellY:0}],world:{widthCells:32,heightCells:32},recipe:HOUSE_RECIPE,phase:'finished',sourceLevels:0});
      const reference=new Mesh('reference',scene);kit.build(reference,plan);
      const root=new Mesh('deferred',scene),steps=kit.buildSteps(root,plan,undefined,8192);
      steps.next();expect(root.getChildMeshes()).toHaveLength(0);
      let yields=1;for(const step of steps){void step;yields++;}
      expect(yields).toBeGreaterThan(10);
      expect(root.getChildMeshes().every(m=>m.getTotalVertices()<=8192)).toBe(true);
      expect(root.getChildMeshes().reduce((n,m)=>n+m.getTotalVertices(),0)).toBe(reference.getChildMeshes().reduce((n,m)=>n+m.getTotalVertices(),0));
      const gone=new Mesh('gone',scene),cancelled=kit.buildSteps(gone,plan,undefined,8192);cancelled.next();gone.dispose();cancelled.return(gone);
      expect(scene.meshes.some(m=>m.parent===gone)).toBe(false);
    }finally{scene.dispose();engine.dispose();}
  });
});
