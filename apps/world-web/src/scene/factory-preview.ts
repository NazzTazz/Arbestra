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
import {buildingPlan,HALL_RECIPE,HOUSE_RECIPE,LOG_HOUSE_RECIPE,BEAM_HOUSE_RECIPE,withBuildingAccesses,type BuildingRecipe} from './building-plan';
import {buildBarracks} from './barracks-factory';
import { CAMPUS_SUBDIVISIONS, MATHEMATICS_CROWN_WIDTH } from './mathematics-factory';
import { buildUniversity } from './university-factory';
import { CELL_UNITS } from './world-space';
import {buildInfrastructurePresentation,type InfrastructureRecipe} from './infrastructure-factory';

async function openWorkshop(){
const query=new URLSearchParams(location.search),world=query.get('world')??'aube';
const capability=await fetch(`/api/worlds/${encodeURIComponent(world)}/factory-access`,{credentials:'same-origin'});
if(!capability.ok||!(await capability.json() as {enabled:boolean}).enabled){document.body.textContent='Ateliers indisponibles pour ce monde.';return;}
document.body.style.cssText='margin:0;background:#24372d;color:#f4eedb;font:15px Georgia,serif';
document.body.innerHTML='<canvas style="width:100vw;height:100vh;display:block"></canvas><aside style="position:fixed;top:16px;left:16px;background:#13221ee8;padding:18px;border:1px solid #b6a787;border-radius:8px;max-width:280px"><h2 style="margin-top:0">Atelier des bâtiments</h2><label>Recette <select id="recipe"><option value="hall">Hôtel de ville</option><option value="house">Maison · deux niveaux</option><option value="logs">Maison · troncs</option><option value="beams">Maison · madriers</option><option value="logs-2">Maison · troncs, deux niveaux</option><option value="beams-2">Maison · madriers, deux niveaux</option><option value="wall">Maison · muret</option></select></label><p><label>État <select id="phase"><option value="finished">Achevé</option><option value="works">Travaux</option></select></label></p><p><label>Orientation <select id="turn"><option value="0">0°</option><option value="1">90°</option><option value="2">180°</option><option value="3">270°</option></select></label></p><p id="budget"></p><small>Vue isolée : aucune donnée du village modifiée.<br>Glisser pour tourner ; molette pour zoomer.</small></aside>';
const canvas=document.querySelector('canvas')!,engine=new Engine(canvas,true),scene=new Scene(engine);scene.clearColor=new Color4(.14,.2,.17,1);
const camera=new ArcRotateCamera('workshop-camera',-Math.PI/3,1.05,11,new Vector3(0,1,0),scene);camera.attachControl(canvas,true);camera.lowerRadiusLimit=3;camera.upperRadiusLimit=30;camera.minZ=.05;camera.wheelPrecision=35;
new HemisphericLight('workshop-day',new Vector3(-.5,1,-.3),scene).intensity=1.1;
const ground=MeshBuilder.CreateGround('workshop-ground',{width:25,height:25},scene),material=new StandardMaterial('workshop-grass',scene);material.diffuseColor=Color3.FromHexString('#526d40');material.specularColor=Color3.Black();ground.material=material;
const kit=new TimberThatch(scene);let root:Mesh|null=null;
const accessControls=document.createElement('div');accessControls.innerHTML='<p><label>Accès principal <select id="access-face"><option value="default">Recette</option><option value="-x">Gauche</option><option value="+x">Droite</option><option value="-z">Avant</option><option value="+z">Arrière</option></select></label></p><p><label><input id="access-secondary" type="checkbox"> Accès secondaire opposé</label></p>';
document.getElementById('budget')!.before(accessControls);accessControls.addEventListener('change',()=>render());
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
function showFootprint(columns:number,rows:number,turn:number,subdivisions=8){
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
function render(){canvas.dataset.ready='false';canvas.dataset.generation=String(Number(canvas.dataset.generation??0)+1);root?.dispose(false,false);const name=choice('recipe'),works=choice('phase')==='works',turn=Number(choice('turn'));
  accessControls.hidden=name.startsWith('infra-')||name.startsWith('university-')||name==='barracks';
  (document.getElementById('access-secondary') as HTMLInputElement).disabled=name==='wall';
  if(name.startsWith('infra-')) {
    const fixture=name.slice(6) as InfrastructureRecipe['fixture'];
    const span=Math.ceil(2*(Number(choice('infra-length'))+Number(choice('infra-width'))/16+.0625));showFootprint(span,span,turn);
    root=buildInfrastructurePresentation(scene,{fixture,width:Number(choice('infra-width')),length:Number(choice('infra-length')),material:choice('infra-material'),border:(document.getElementById('infra-border') as HTMLInputElement).checked,quarterTurns:turn,pavementHeight:Number(choice('infra-pavement-height')),curbHeight:Number(choice('infra-curb-height')),brazierScale:Number(choice('infra-brazier-scale'))});
    const extent=Number(choice('infra-length'))*CELL_UNITS;
    const left=new Vector3(-extent,.04,0),right=new Vector3(extent,.04,0),back=new Vector3(0,.04,extent),front=new Vector3(0,.04,-extent);
    const points=fixture==='brazier'?[]:fixture==='door'?[left,new Vector3(0,.04,0)]:fixture==='straight'?[left,right]:fixture==='elbow'?[left,back]:fixture==='t'?[left,right,back]:[left,right,front,back];
    const access=MeshBuilder.CreateLineSystem('infrastructure-accesses',{lines:points.map(p=>[p,p.add(new Vector3(0,.5,0))])},scene);access.color=Color3.FromHexString('#64cbe6');access.parent=root;
    document.getElementById('budget')!.textContent=`Pivot central · accès aux extrémités · ${Number(choice('infra-width'))} / 8 case utile · trottoirs continus`;
    const meshes=root.getChildMeshes().filter(m=>m.getTotalVertices()>0);canvas.dataset.vertices=String(meshes.reduce((n,m)=>n+m.getTotalVertices(),0));canvas.dataset.meshes=String(meshes.length);
    camera.radius=13;camera.target.y=.1;return;
  }
  if(name.startsWith('university-')){
    const level=Number(name.slice(-1));showFootprint(5,6,turn,CAMPUS_SUBDIVISIONS);
    const start=performance.now();root=new Mesh('workshop-university',scene);root.rotation.y=turn*Math.PI/2;
    buildUniversity(root,kit,level,works?'works':'finished',level-1,{mathematics:false,astronomy:false},true);
    const meshes=root.getChildMeshes().filter(m=>m.getTotalVertices()>0),vertices=meshes.reduce((n,m)=>n+m.getTotalVertices(),0);
    document.getElementById('budget')!.textContent=`Campus ${level} · 40 × 48 sous-cases · Maths : ${level===3?'38 × 6 au sol, 22 × 6 aux deux niveaux supérieurs':'22 × 6, '+level+' niveau(x)'} + pavillon central ${MATHEMATICS_CROWN_WIDTH} × 6 · socle ${level===3?5:3} × 1 cases / ${level*2} marches · Médecine : ${level===1?'8 × 22':level===2?'C : 8 × 22 + deux ailes 8 × 6':'C + étage 8 × 22'} · toit plat · Géographie : 3 × 1 cases, ${level===1?'plain-pied':level===2?'chapeau central':'podium 2 / 3 / 1'} · ${vertices.toLocaleString('fr')} sommets · ${meshes.length} meshes · ${(performance.now()-start).toFixed(0)} ms`;
    canvas.dataset.vertices=String(vertices);canvas.dataset.meshes=String(meshes.length);camera.radius=24;camera.target.y=1.4;return;
  }
  if(name==='barracks'){
    showFootprint(2,5,turn);
    const start=performance.now();root=new Mesh('workshop-barracks',scene);root.rotation.y=turn*Math.PI/2;buildBarracks(root,kit,works?'works':'finished');
    const meshes=root.getChildMeshes().filter(m=>m.getTotalVertices()>0),vertices=meshes.reduce((n,m)=>n+m.getTotalVertices(),0);
    document.getElementById('budget')!.textContent=`Caserne · 2 × 5 cases · cour 2 × 3 · ${vertices.toLocaleString('fr')} sommets · ${meshes.length} meshes · ${(performance.now()-start).toFixed(0)} ms`;
    canvas.dataset.vertices=String(vertices);canvas.dataset.meshes=String(meshes.length);camera.radius=20;camera.target.y=1;return;
  }
  camera.radius=11;
  showFootprint(1,name==='hall'?2:1,turn);
  let recipe:BuildingRecipe=name==='hall'?HALL_RECIPE:name.startsWith('logs')?{...LOG_HOUSE_RECIPE,levels:name.endsWith('-2')?2:1}:name.startsWith('beams')?{...BEAM_HOUSE_RECIPE,levels:name.endsWith('-2')?2:1}:name==='house'?{...HOUSE_RECIPE,levels:2}:{...HOUSE_RECIPE,modules:[4,4],walls:{courses:3,gateWidth:.7}};
  const face=(choice('access-face')==='default'?recipe.entrance.face:choice('access-face')) as BuildingRecipe['entrance']['face'];
  recipe=withBuildingAccesses(recipe,face,(document.getElementById('access-secondary') as HTMLInputElement).checked&&name!=='wall');
  const cells=name==='hall'?(turn%2?[{cellX:4,cellY:4},{cellX:5,cellY:4}]:[{cellX:4,cellY:4},{cellX:4,cellY:5}]):[{cellX:4,cellY:4}];
  const start=performance.now(),plan=buildingPlan({id:'preview',anchor:cells[0]!,cells,world:{widthCells:32,heightCells:32},recipe,quarterTurns:turn,phase:works?'works':'finished',sourceLevels:name==='house'||name.endsWith('-2')?1:0});
  root=new Mesh('workshop-building',scene);root.position.y=plan.origin.y;root.rotation.y=plan.rotation;kit.build(root,plan);
  const markers=MeshBuilder.CreateLineSystem('building-accesses',{lines:plan.accesses.map(a=>[new Vector3(a.entry.threshold.x,.03,a.entry.threshold.z),new Vector3(a.entry.gate.x,.03,a.entry.gate.z),new Vector3(a.entry.gate.x,.6,a.entry.gate.z)])},scene);markers.color=Color3.FromHexString('#64cbe6');markers.parent=root;markers.isPickable=false;
  const meshes=root.getChildMeshes(),vertices=meshes.reduce((n,m)=>n+m.getTotalVertices(),0);
  document.getElementById('budget')!.textContent=`${plan.width.toFixed(2)} × ${plan.depth.toFixed(2)} · ${recipe.levels} niveau(x) · ${vertices.toLocaleString('fr')} sommets · ${meshes.length} meshes · ${(performance.now()-start).toFixed(0)} ms`;
  canvas.dataset.vertices=String(vertices);canvas.dataset.meshes=String(meshes.length);
}
for(const id of ['recipe','phase','turn'])document.getElementById(id)!.addEventListener('change',render);
const barracksOption=document.createElement('option');barracksOption.value='barracks';barracksOption.textContent='Caserne · cour d’entraînement';document.getElementById('recipe')!.append(barracksOption);
for(let level=1;level<=3;level++){const option=document.createElement('option');option.value=`university-${level}`;option.textContent=`Université · niveau ${level}`;document.getElementById('recipe')!.append(option);}
(document.getElementById('recipe') as HTMLSelectElement).value='university-1';
if(query.get('domain')==='infrastructure') {
  accessControls.hidden=true;
  for(const id of ['phase','roof-colour','stone-colour','frame-colour'])document.getElementById(id)!.closest('p')!.hidden=true;
  document.querySelector('h2')!.textContent='Factory : Infrastructure';
  document.getElementById('recipe')!.innerHTML=['straight','elbow','t','crossing','door','brazier'].map((v,i)=>`<option value="infra-${v}">${['Droit','Angle','T','Croisement','Jonction à une porte','Brasero'][i]}</option>`).join('');
  const controls=document.createElement('div');controls.innerHTML='<p><label>Largeur <select id="infra-width"><option>2</option><option selected>4</option><option>8</option></select> / 8 case</label></p><p><label>Longueur <select id="infra-length"><option>1</option><option selected>2</option></select> cases</label></p><p><label>Revêtement <select id="infra-material"><option value="none">Pas de route</option><option value="earth">Terre</option><option selected value="stone-1">Pierre 1 · 3 × 1</option><option value="stone-2">Pierre 2 · 4 × 2</option></select></label></p><p><label><input id="infra-border" type="checkbox" checked> Trottoirs pierre</label></p><p><label>Épaisseur du pavage <select id="infra-pavement-height"><option value=".02">Fine</option><option selected value=".04">Carte actuelle</option><option value=".08">Épaisse</option></select></label></p><p><label>Épaisseur des trottoirs <select id="infra-curb-height"><option value=".06">Basse</option><option selected value=".04">Carte actuelle</option><option value=".18">Haute</option></select></label></p><p><label>Échelle du brasero <select id="infra-brazier-scale"><option value=".75">75 %</option><option selected value="1">100 %</option><option value="1.25">125 %</option></select></label></p>';
  document.getElementById('budget')!.before(controls);controls.addEventListener('change',render);
}
render();engine.runRenderLoop(()=>{scene.render();if(root?.getChildMeshes().every(m=>m.isReady())){canvas.dataset.ready='true';canvas.dataset.renderedGeneration=canvas.dataset.generation;}});window.addEventListener('resize',()=>engine.resize());
window.addEventListener('pagehide',()=>{scene.dispose();engine.dispose();},{once:true});
const revoke=window.setInterval(()=>{void fetch(`/api/worlds/${encodeURIComponent(world)}/factory-access`,{credentials:'same-origin'}).then(async r=>{if(!r.ok||!(await r.json() as {enabled:boolean}).enabled){clearInterval(revoke);scene.dispose();engine.dispose();document.body.textContent='Accès aux ateliers désactivé. Retournez au village.';}}).catch(()=>{});},5000);
window.addEventListener('pagehide',()=>clearInterval(revoke),{once:true});
}
void openWorkshop().catch(()=>{document.body.textContent='Impossible de vérifier l’accès à l’atelier.';});
