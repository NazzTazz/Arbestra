import { BuildingGeometry } from './building-geometry';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { buildingPlan, HALL_RECIPE, type BuildingPlan, type BuildingRecipe } from './building-plan';
import { CELL_UNITS } from './world-space';
import { TimberThatch, timberBeamGeometry } from './timber-thatch';
import { glazeWindows } from './frosted-glass';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { VillageBraziers } from './village-braziers';

export const CAMPUS_SUBDIVISIONS = 8;
export const CAMPUS_SUBCELL_UNITS = CELL_UNITS / CAMPUS_SUBDIVISIONS;
export const MATHEMATICS_CROWN_WIDTH = 10;

/** Workshop module only: dimensions include masonry joints, not roof overhangs. */
function mathematicsPlan(id: string, length: number, levels: number, phase: 'finished' | 'works', sourceLevels: number, transverse = false) {
  const cells = Math.ceil((length + 1) / CAMPUS_SUBDIVISIONS);
  const bays: NonNullable<BuildingRecipe['windowOpenings']> = [];
  if(transverse){
    // The front is +Z once the long main body has turned through a quarter turn.
    bays.push({face:'+z',level:0,centre:0,width:length-1,sill:1,courses:8});
  }else if(length===22){
    // The ground-floor entrance is an open stone portico, without a side window.
    for(let level=1;level<levels;level++){
      for(const face of ['-x','+x'] as const)for(const centre of [-18,-12,-6,0,6,12,18])
        bays.push({face,level,centre,width:1,sill:1,courses:7});
      for(const face of ['-z','+z'] as const)bays.push({face,level,centre:0,width:1,sill:1,courses:7});
    }
  }else if(length===8){
    for(const face of ['-x','+x'] as const)for(const centre of [-5,0,5])
      bays.push({face,level:0,centre,width:1,sill:1,courses:7});
    // The bay on the joining face is removed together with that interior wall.
    for(const face of ['-z','+z'] as const)bays.push({face,level:0,centre:0,width:1,sill:1,courses:7});
  }
  return buildingPlan({ id, anchor: { cellX: 0, cellY: 0 },
    cells: Array.from({ length: cells }, (_, index) => transverse ? { cellX: index, cellY: 0 } : { cellX: 0, cellY: index }),
    world: { widthCells: 32, heightCells: 32 }, phase, sourceLevels,
    recipe: { ...HALL_RECIPE, id, modules: transverse ? [length, 6] : [6, length], courses: 10, levels,
      module: { ...HALL_RECIPE.module, length: CAMPUS_SUBCELL_UNITS, thickness: CAMPUS_SUBCELL_UNITS / 2 },
      entrance: transverse ? { ...HALL_RECIPE.entrance, face: '-z', enabled: false }
        : { ...HALL_RECIPE.entrance, enabled: length===22, open: true, width: 4, courses: 8 },
      windows: {}, windowOpenings: bays,
      // Leave the two-subcell margin within the reserved three/five-cell strip.
      roof: { ...HALL_RECIPE.roof, lengthExtraRatio: 0, overhang: transverse ? CAMPUS_SUBCELL_UNITS / 2 : 0,
        sideOverhang: transverse ? HALL_RECIPE.roof.sideOverhang ?? 0 : 0,
        ...(transverse ? {} : { style: 'flat-stone' as const }),
        slope: transverse ? 20 : HALL_RECIPE.roof.slope,
        maxSpan: transverse ? length * CAMPUS_SUBCELL_UNITS : HALL_RECIPE.roof.maxSpan } } });
}

export function openLongitudinalJoin(plan: BuildingPlan, face: '-z' | '+z', height: number) {
  const sign = face === '-z' ? -1 : 1;
  const module = plan.recipe.module;
  const wallZ = sign * (plan.depth / 2 - module.thickness / 2);
  plan.stones = plan.stones.filter(stone => !(stone.axis === 'x' && Math.abs(stone.z - wallZ) < 1e-8 && stone.y < height));
  // Alternating courses formerly stopped short to leave room for the gable's
  // corner stones. Once that gable is removed, continue the facade to the seam.
  const stoppedEnd = sign * (plan.depth / 2 - module.thickness - module.joint / 2);
  for (const stone of plan.stones) {
    if (stone.axis !== 'z' || stone.y >= height) continue;
    const end = stone.z + sign * stone.length / 2;
    if (Math.abs(end - stoppedEnd) > 1e-8) continue;
    stone.length += module.thickness;
    stone.z += sign * module.thickness / 2;
  }
  plan.openings = plan.openings.filter(opening => !(opening.face === face && opening.bottom < height));
}

function mathematicsPlatform(parent: Mesh, kit: TimberThatch, level: number) {
  const width=(level===3?5:3)*CELL_UNITS,depth=CELL_UNITS;
  const steps=level*2,stepHeight=HALL_RECIPE.module.height,height=steps*stepHeight;
  const stoneLength=CAMPUS_SUBCELL_UNITS,wallThickness=stoneLength/2,joint=HALL_RECIPE.module.joint;
  const parts: BuildingGeometry[]=[];
  const block=(name:string,x:number,y:number,z:number,w:number,h:number,d:number)=>{
    const mesh=new BuildingGeometry(name,timberBeamGeometry(h,w,d,true,1));
    mesh.position.set(x,y,z);parts.push(mesh);
  };
  // Hollow masonry shell and continuous landing: no invisible solid brick fill.
  for(let course=0;course<steps;course++){
    const y=(course+.5)*stepHeight,throughX=course%2===0;
    for(const side of [-1,1]){
      const xInset=throughX?0:wallThickness;
      for(let x=-width/2+xInset;x<width/2-xInset-1e-8;){
        const end=Math.min(width/2-xInset,x+(x===-width/2+xInset&&course%2?stoneLength/2:stoneLength));
        block('mathematics-platform-stone',(x+end)/2,y,side*(depth/2-wallThickness/2),end-x-joint,stepHeight-joint,wallThickness-joint);x=end;
      }
      const zInset=throughX?wallThickness:0;
      for(let z=-depth/2+zInset;z<depth/2-zInset-1e-8;){
        const end=Math.min(depth/2-zInset,z+(z===-depth/2+zInset&&course%2?stoneLength/2:stoneLength));
        block('mathematics-platform-stone',side*(width/2-wallThickness/2),y,(z+end)/2,wallThickness-joint,stepHeight-joint,end-z-joint);z=end;
      }
    }
  }
  block('mathematics-platform-landing',0,height-.025,0,width,.05,depth);
  const stairWidth=2*CELL_UNITS;
  for(let step=0;step<steps;step++){
    const h=(step+1)*stepHeight,z=depth/2+(steps-step-.5)*CAMPUS_SUBCELL_UNITS;
    for(let column=0;column<16;column++)
      block('mathematics-stair',-stairWidth/2+(column+.5)*stoneLength,h/2,z,stoneLength-joint,h,CAMPUS_SUBCELL_UNITS-joint);
  }
  const merged=new Mesh('mathematics-stone-platform',kit.scene);
  BuildingGeometry.merge(parts).applyToMesh(merged);
  merged.name='mathematics-stone-platform';merged.parent=parent;merged.material=kit.stone;merged.receiveShadows=true;merged.isPickable=false;
  return height;
}

function mathematicsPortico(parent: Mesh, kit: TimberThatch, platformHeight: number, phase: 'finished'|'works') {
  const parts: Mesh[]=[],unit=CAMPUS_SUBCELL_UNITS,course=HALL_RECIPE.module.height;
  const roofBottom=9*course,columnZ=4.5*unit,columnX=3.5*unit;
  const block=(name:string,x:number,y:number,z:number,width:number,height:number,depth:number)=>{
    const mesh=new Mesh(name,kit.scene);timberBeamGeometry(height,width,depth,true,1).applyToMesh(mesh);
    mesh.position.set(x,platformHeight+y,z);mesh.material=kit.stone;parts.push(mesh);
  };
  for(const sign of [-1,1]){
    block('mathematics-portico-column-base',sign*columnX,course/2,columnZ,unit,course,unit);
    const shaftHeight=phase==='works'?(roofBottom-2*course)*.65:roofBottom-2*course;
    const shaft=MeshBuilder.CreateCylinder('mathematics-portico-column',{diameter:unit*.6,height:shaftHeight,tessellation:8},kit.scene);
    shaft.position.set(sign*columnX,platformHeight+course+shaftHeight/2,columnZ);shaft.material=kit.stone;parts.push(shaft);
    if(phase==='finished')block('mathematics-portico-column-capital',sign*columnX,roofBottom-course/2,columnZ,unit,course,unit);
  }
  if(phase==='finished')block('mathematics-portico-stone-canopy',0,roofBottom+course/2,4*unit,8*unit,course,3*unit);
  const merged=Mesh.MergeMeshes(parts,true,true);
  if(!merged)throw new Error('Mathematics portico geometry merge failed');
  merged.name='mathematics-stone-portico';merged.parent=parent;merged.material=kit.stone;merged.receiveShadows=true;merged.isPickable=false;
}

export function buildMathematics(root: Mesh, kit: TimberThatch, level: number, phase: 'finished' | 'works', previewFires = true) {
  const site=new Mesh('mathematics-campus-site',kit.scene);site.parent=root;
  site.position.z=2.5*CELL_UNITS;site.rotation.y=Math.PI;
  const platformHeight=mathematicsPlatform(site,kit,level);
  mathematicsPortico(site,kit,platformHeight,phase);
  if (previewFires && level === 3 && phase === 'finished') {
    const braziers = new VillageBraziers(kit.scene), world = site.computeWorldMatrix(true);
    const points = [-1, 1].flatMap(sign => [3.125, 4.375, 5.625].map((x, index) => {
      const p = Vector3.TransformCoordinates(new Vector3(sign * x, .02, CELL_UNITS / 2 + .18), world);
      return { x: p.x, y: p.y, z: p.z, seed: (index + (sign > 0 ? 3 : 0) + .5) / 6 };
    }));
    braziers.updatePoints(points, site);
    // This isolated workshop has no solar clock: show the fires for the recipe.
    const observer = kit.scene.onBeforeRenderObservable.add(() => braziers.animate(performance.now(), true, 1));
    site.onDisposeObservable.add(() => { kit.scene.onBeforeRenderObservable.remove(observer); braziers.dispose(); });
  }
  const central = mathematicsPlan('mathematics-central', 22, level, phase, level > 1 ? level - 1 : 0);
  const body=new Mesh('mathematics-raised-body',kit.scene);body.parent=site;
  body.position.y=platformHeight-central.base;
  const parts: Array<{ plan: BuildingPlan; offset: number }> = [{ plan: central, offset: 0 }];
  if (level === 3) {
    // Ground-floor passages replace the joining gable walls; upper gables remain.
    const groundHeight = central.recipe.courses * central.recipe.module.height;
    openLongitudinalJoin(central, '-z', groundHeight);
    openLongitudinalJoin(central, '+z', groundHeight);
    for (const side of [-1, 1]) {
      const annex = mathematicsPlan(`mathematics-annex-${side}`, 8, 1, phase, 0);
      openLongitudinalJoin(annex, side < 0 ? '+z' : '-z', groundHeight);
      parts.push({ plan: annex, offset: side * 15 * CAMPUS_SUBCELL_UNITS });
    }
  }
  for (const { plan, offset } of parts) {
    const child = new Mesh(plan.id, kit.scene); child.parent = body;
    child.rotation.y = Math.PI / 2;
    child.position.set(offset, plan.base, 0);
    const crownHalfWidth = MATHEMATICS_CROWN_WIDTH * CAMPUS_SUBCELL_UNITS / 2;
    kit.build(child, plan, plan === central ? [-crownHalfWidth, crownHalfWidth] : undefined);
    glazeWindows(child, plan);
    for (const mesh of child.getChildMeshes()) mesh.isPickable = false;
  }
  const crown = mathematicsPlan('mathematics-central-pavilion', MATHEMATICS_CROWN_WIDTH, 1, phase, 0, true);
  const crownRoot = new Mesh(crown.id, kit.scene); crownRoot.parent = body;
  const supportHeight = phase === 'works'
    ? Math.ceil(Math.max(central.sourceLevels * central.recipe.courses * central.recipe.module.height, central.height * .65) / central.recipe.module.height) * central.recipe.module.height
    : central.height;
  crownRoot.position.y = central.base + supportHeight;
  kit.build(crownRoot, crown);
  glazeWindows(crownRoot, crown);
  for (const mesh of crownRoot.getChildMeshes()) mesh.isPickable = false;
  return root;
}
