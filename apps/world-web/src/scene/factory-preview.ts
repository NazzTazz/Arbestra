import '@babylonjs/core/Shaders/default.vertex';
import '@babylonjs/core/Shaders/default.fragment';
import {Engine} from '@babylonjs/core/Engines/engine';
import {Scene} from '@babylonjs/core/scene';
import {ArcRotateCamera} from '@babylonjs/core/Cameras/arcRotateCamera';
import {HemisphericLight} from '@babylonjs/core/Lights/hemisphericLight';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {Color3,Color4} from '@babylonjs/core/Maths/math.color';
import {Mesh} from '@babylonjs/core/Meshes/mesh';
import {MeshBuilder} from '@babylonjs/core/Meshes/meshBuilder';
import {StandardMaterial} from '@babylonjs/core/Materials/standardMaterial';
import {TimberThatch} from './timber-thatch';
import {buildingPlan,HALL_RECIPE,HOUSE_RECIPE,type BuildingRecipe} from './building-plan';
import {buildBarracks} from './barracks-factory';
import { CAMPUS_SUBDIVISIONS, MATHEMATICS_CROWN_WIDTH } from './mathematics-factory';
import { buildUniversity } from './university-factory';
import { CELL_UNITS } from './world-space';

// Isolated local workshop: no requests, village commands or public building editor.
document.body.style.cssText='margin:0;background:#24372d;color:#f4eedb;font:15px Georgia,serif';
document.body.innerHTML='<canvas style="width:100vw;height:100vh;display:block"></canvas><aside style="position:fixed;top:16px;left:16px;background:#13221ee8;padding:18px;border:1px solid #b6a787;border-radius:8px;max-width:280px"><h2 style="margin-top:0">Atelier des bâtiments</h2><label>Recette <select id="recipe"><option value="hall">Hôtel de ville</option><option value="house">Maison · deux niveaux</option><option value="wall">Maison · muret</option></select></label><p><label>État <select id="phase"><option value="finished">Achevé</option><option value="works">Travaux</option></select></label></p><p><label>Orientation <select id="turn"><option value="0">0°</option><option value="1">90°</option><option value="2">180°</option><option value="3">270°</option></select></label></p><p id="budget"></p><small>Vue isolée : aucune donnée du village modifiée.<br>Glisser pour tourner ; molette pour zoomer.</small></aside>';
const canvas=document.querySelector('canvas')!,engine=new Engine(canvas,true),scene=new Scene(engine);scene.clearColor=new Color4(.14,.2,.17,1);
const camera=new ArcRotateCamera('workshop-camera',-Math.PI/3,1.05,11,new Vector3(0,1,0),scene);camera.attachControl(canvas,true);camera.lowerRadiusLimit=3;camera.upperRadiusLimit=30;camera.minZ=.05;camera.wheelPrecision=35;
new HemisphericLight('workshop-day',new Vector3(-.5,1,-.3),scene).intensity=1.1;
const ground=MeshBuilder.CreateGround('workshop-ground',{width:25,height:25},scene),material=new StandardMaterial('workshop-grass',scene);material.diffuseColor=Color3.FromHexString('#526d40');material.specularColor=Color3.Black();ground.material=material;
const kit=new TimberThatch(scene);let root:Mesh|null=null;
const woodOptions=[['brown','Bois brun'],['light','Bois clair'],['natural','Bois naturel']];
const stoneOptions=[['light','Pierre claire'],['red','Briques rouges'],['dark','Pierre sombre']];
const woodColours:Record<string,string>={brown:'#927059',light:'#fff4de',natural:'#ded5c8'};
const stoneColours:Record<string,string>={light:'#fafbfc',red:'#b65f49',dark:'#606977'};
function paletteSelector(id:string,title:string,options:string[][],initial:string,material:StandardMaterial,colours:Record<string,string>){
  const row=document.createElement('p'),label=document.createElement('label'),select=document.createElement('select');
  label.append(`${title} `);select.id=id;
  for(const [value,text] of options){const option=document.createElement('option');option.value=value!;option.textContent=text!;select.append(option);}
  select.value=initial;label.append(select);row.append(label);document.getElementById('budget')!.before(row);
  select.addEventListener('change',()=>{material.diffuseColor=Color3.FromHexString(colours[select.value]!);});
}
paletteSelector('roof-colour','Toit',woodOptions,'natural',kit.boards,{...woodColours,natural:'#d7cbb9'});
paletteSelector('stone-colour','Maçonnerie',stoneOptions,'light',kit.stone,stoneColours);
paletteSelector('frame-colour','Charpente',woodOptions,'natural',kit.wood,woodColours);
let footprint:Mesh|null=null;
const footprintMaterial=new StandardMaterial('workshop-footprint-fill',scene);
scene.setRenderingAutoClearDepthStencil(1,false);
footprintMaterial.diffuseColor=Color3.FromHexString('#b6d4e5');footprintMaterial.emissiveColor=new Color3(.12,.18,.22);footprintMaterial.specularColor=Color3.Black();footprintMaterial.alpha=.12;footprintMaterial.zOffset=-1;
function showFootprint(columns:number,rows:number,turn:number,subdivisions=1){
  footprint?.dispose(false,false);footprint=new Mesh('workshop-footprint',scene);footprint.rotation.y=turn*Math.PI/2;
  const width=columns*CELL_UNITS,depth=rows*CELL_UNITS,lines:Vector3[][]=[];
  for(let x=0;x<=columns;x++)lines.push([new Vector3(-width/2+x*CELL_UNITS,.014,-depth/2),new Vector3(-width/2+x*CELL_UNITS,.014,depth/2)]);
  for(let z=0;z<=rows;z++)lines.push([new Vector3(-width/2,.014,-depth/2+z*CELL_UNITS),new Vector3(width/2,.014,-depth/2+z*CELL_UNITS)]);
  const grid=MeshBuilder.CreateLineSystem('workshop-footprint-grid',{lines},scene);grid.color=Color3.FromHexString('#ffffff');grid.alpha=.95;grid.parent=footprint;grid.isPickable=false;grid.renderingGroupId=1;
  if(subdivisions>1){
    const minorLines:Vector3[][]=[],halfLines:Vector3[][]=[],step=CELL_UNITS/subdivisions;
    for(let x=1;x<columns*subdivisions;x++)if(x%subdivisions){
      const group=x%subdivisions===subdivisions/2?halfLines:minorLines;
      group.push([new Vector3(-width/2+x*step,.014,-depth/2),new Vector3(-width/2+x*step,.014,depth/2)]);
    }
    for(let z=1;z<rows*subdivisions;z++)if(z%subdivisions){
      const group=z%subdivisions===subdivisions/2?halfLines:minorLines;
      group.push([new Vector3(-width/2,.014,-depth/2+z*step),new Vector3(width/2,.014,-depth/2+z*step)]);
    }
    const minorGrid=MeshBuilder.CreateLineSystem('workshop-subcell-grid',{lines:minorLines},scene);minorGrid.color=Color3.FromHexString('#214e91');minorGrid.alpha=.38;minorGrid.parent=footprint;minorGrid.isPickable=false;minorGrid.renderingGroupId=1;
    if(halfLines.length){
      const halfGrid=MeshBuilder.CreateLineSystem('workshop-halfcell-grid',{lines:halfLines},scene);halfGrid.color=Color3.FromHexString('#4685cf');halfGrid.alpha=.72;halfGrid.parent=footprint;halfGrid.isPickable=false;halfGrid.renderingGroupId=1;
    }
  }
  const fill=MeshBuilder.CreateGround('workshop-footprint-fill',{width,height:depth},scene);fill.position.y=.01;fill.material=footprintMaterial;fill.parent=footprint;fill.isPickable=false;
  canvas.dataset.footprint=`${columns}x${rows}`;
  canvas.dataset.subdivisions=String(subdivisions);
}
const choice=(id:string)=>(document.getElementById(id) as HTMLSelectElement).value;
function render(){root?.dispose(false,false);const name=choice('recipe'),works=choice('phase')==='works',turn=Number(choice('turn'));
  if(name.startsWith('university-')){
    const level=Number(name.slice(-1));showFootprint(5,6,turn,CAMPUS_SUBDIVISIONS);
    const start=performance.now();root=new Mesh('workshop-university',scene);root.rotation.y=turn*Math.PI/2;
    buildUniversity(root,kit,level,works?'works':'finished',level-1,{mathematics:false,astronomy:false},true);
    const meshes=root.getChildMeshes().filter(m=>m.getTotalVertices()>0),vertices=meshes.reduce((n,m)=>n+m.getTotalVertices(),0);
    document.getElementById('budget')!.textContent=`Campus ${level} · 40 × 48 sous-cases · Maths : ${level===3?'38 × 6 au sol, 22 × 6 aux deux niveaux supérieurs':'22 × 6, '+level+' niveau(x)'} + pavillon central ${MATHEMATICS_CROWN_WIDTH} × 6 · socle ${level===3?5:3} × 1 cases / ${level*2} marches · Médecine : ${level===1?'8 × 22':level===2?'C : 8 × 22 + deux ailes 8 × 6':'C + étage 8 × 22'} · toit plat · Géographie : 3 × 1 cases, ${level===1?'plain-pied':level===2?'chapeau central':'podium 2 / 3 / 1'} · ${vertices.toLocaleString('fr')} sommets · ${meshes.length} meshes · ${(performance.now()-start).toFixed(0)} ms`;
    canvas.dataset.ready='true';canvas.dataset.vertices=String(vertices);canvas.dataset.meshes=String(meshes.length);camera.radius=24;camera.target.y=1.4;return;
  }
  if(name==='barracks'){
    showFootprint(2,5,turn);
    const start=performance.now();root=new Mesh('workshop-barracks',scene);root.rotation.y=turn*Math.PI/2;buildBarracks(root,kit,works?'works':'finished');
    const meshes=root.getChildMeshes().filter(m=>m.getTotalVertices()>0),vertices=meshes.reduce((n,m)=>n+m.getTotalVertices(),0);
    document.getElementById('budget')!.textContent=`Caserne · 2 × 5 cases · cour 2 × 3 · ${vertices.toLocaleString('fr')} sommets · ${meshes.length} meshes · ${(performance.now()-start).toFixed(0)} ms`;
    canvas.dataset.ready='true';canvas.dataset.vertices=String(vertices);canvas.dataset.meshes=String(meshes.length);camera.radius=20;camera.target.y=1;return;
  }
  camera.radius=11;
  showFootprint(1,name==='hall'?2:1,turn);
  const recipe:BuildingRecipe=name==='hall'?HALL_RECIPE:name==='house'?{...HOUSE_RECIPE,levels:2}:{...HOUSE_RECIPE,modules:[4,4],walls:{courses:3,gateWidth:.7}};
  const cells=name==='hall'?(turn%2?[{cellX:4,cellY:4},{cellX:5,cellY:4}]:[{cellX:4,cellY:4},{cellX:4,cellY:5}]):[{cellX:4,cellY:4}];
  const start=performance.now(),plan=buildingPlan({id:'preview',anchor:cells[0]!,cells,world:{widthCells:32,heightCells:32},recipe,quarterTurns:turn,phase:works?'works':'finished',sourceLevels:name==='house'?1:0});
  root=new Mesh('workshop-building',scene);root.position.y=plan.origin.y;root.rotation.y=plan.rotation;kit.build(root,plan);
  const meshes=root.getChildMeshes(),vertices=meshes.reduce((n,m)=>n+m.getTotalVertices(),0);
  document.getElementById('budget')!.textContent=`${plan.width.toFixed(2)} × ${plan.depth.toFixed(2)} · ${recipe.levels} niveau(x) · ${vertices.toLocaleString('fr')} sommets · ${meshes.length} meshes · ${(performance.now()-start).toFixed(0)} ms`;
  canvas.dataset.ready='true';canvas.dataset.vertices=String(vertices);canvas.dataset.meshes=String(meshes.length);
}
for(const id of ['recipe','phase','turn'])document.getElementById(id)!.addEventListener('change',render);
const barracksOption=document.createElement('option');barracksOption.value='barracks';barracksOption.textContent='Caserne · cour d’entraînement';document.getElementById('recipe')!.append(barracksOption);
for(let level=1;level<=3;level++){const option=document.createElement('option');option.value=`university-${level}`;option.textContent=`Université · niveau ${level}`;document.getElementById('recipe')!.append(option);}
(document.getElementById('recipe') as HTMLSelectElement).value='university-1';
render();engine.runRenderLoop(()=>scene.render());window.addEventListener('resize',()=>engine.resize());
window.addEventListener('pagehide',()=>{scene.dispose();engine.dispose();},{once:true});
