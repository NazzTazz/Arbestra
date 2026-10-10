import {createStudyCoordinates} from './study-coordinates';
import {createGeographicFlowView} from './geographic-flow-view';
import {flatPreviewPoint,renderIdentity,type PreviewView} from './preview-inspection';
import {Camera} from '@babylonjs/core/Cameras/camera';
import { buildWorldOutcrops } from './world-outcrops';
import { torusTreeMatrix } from './world-tree-transform';
import { buildWorldGeometry, type WorldGeometryBuffers } from './world-geography-mesh';
import { sampleWorldGeography } from '@arbestra/contracts/world-geography';
import { createHydrologyView } from './hydrology-view';
import { useEffect, useRef, useState } from 'react';
import '@babylonjs/core/Culling/ray';
import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import {DirectionalLight} from '@babylonjs/core/Lights/directionalLight';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';
import '@babylonjs/core/Shaders/shadowMap.vertex';
import '@babylonjs/core/Shaders/shadowMap.fragment';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import { Matrix } from '@babylonjs/core/Maths/math.vector';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { SceneInstrumentation } from '@babylonjs/core/Instrumentation/sceneInstrumentation';
import { PointerEventTypes } from '@babylonjs/core/Events/pointerEvents';
import { COSMOLOGY, combinedPeriod, cyclePhases, sunPosition, torusFrame, illumination } from '@arbestra/contracts/cosmology';
import { naturalStairPairs, climateHash, wrapClimate, type GeneratedLandscape } from '@arbestra/contracts';
import { TorusFog } from '../scene/torus-fog';
import { WeatherMap } from '../scene/weather-view';
import { stairProfile } from './stair-profile';
import { altitudeColor } from './altitude-color';
export type PreviewLayer='terrain'|'altitude'|'exposure'|'humidity'|'accessibility'|'water';
export interface PreviewStats {renderKey?:string;fps:number;median:number;p95:number;draws:number;meshes:number;indices:number;residentVertices:number;materials:number;textures:number;backend:string;fogPasses:number}
export interface PreviewRenderState {key:string;status:'building'|'ready'|'error';message?:string}
export interface PreviewMapOverlay { disk?:{x:number;y:number}; requestedAt?:number; diagnosticPoint?:{x:number;y:number}; diagnosticRequestedAt?:number; lines: Array<{ points: Array<{ x:number; y:number }>; color:'diagnostic'|'error'|'selection'|'village' }> }
interface Props {chunks?:boolean;coordinates?:boolean;flat?:boolean;candidateKey?:string;onRenderState?:(state:PreviewRenderState)=>void;grid?:boolean;wireframe?:boolean;data:GeneratedLandscape;local:boolean;center:{x:number;y:number};layer:PreviewLayer;fog:boolean;solar:boolean;exaggeration:number;cycleDegrees:number;
 arrivalMap?:boolean; mapOverlay?:PreviewMapOverlay; onHover?:(x:number,y:number,screenX:number,screenY:number)=>void; onLeave?:()=>void; onMapKey?:(key:string)=>void;
 mapGeometry?:WorldGeometryBuffers;
 onPick:(x:number,y:number)=>void;onStats:(stats:PreviewStats)=>void}
export function PreviewScene(props:Props){
  const canvas=useRef<HTMLCanvasElement>(null),callbacks=useRef(props);callbacks.current=props;
  const activeCamera=useRef<ArcRotateCamera|null>(null),engineRef=useRef<Engine|null>(null);
  const zoom=(factor:number)=>{const camera=activeCamera.current;if(camera)camera.radius=Math.max(camera.lowerRadiusLimit??0,Math.min(camera.upperRadiusLimit??Infinity,camera.radius*factor));};
  const resetMap=()=>{const camera=activeCamera.current,engine=engineRef.current;if(camera&&engine){camera.setTarget(Vector3.Zero(),false,false,true);camera.alpha=-Math.PI/2;camera.beta=.001;camera.radius=Math.max(props.data.width/(engine.getRenderWidth()/Math.max(1,engine.getRenderHeight())),props.data.height)*.55;}};
  const poses=useRef(new Map<PreviewView,{alpha:number;beta:number;radius:number;target:Vector3;groundHeight:number}>());
  const view:PreviewView=props.local?'local':props.flat?'map':'torus';
  const identity=renderIdentity({candidate:props.candidateKey??`${props.data.seed}:${props.data.recipeRevision}`,view,layer:props.layer,x:props.center.x,y:props.center.y,fog:props.fog,solar:props.solar,exaggeration:props.exaggeration,grid:!!props.grid,wireframe:!!props.wireframe})+(props.coordinates?'|coordinates':'');
  const desired=useRef(identity);desired.current=identity;
  const [rendered,setRendered]=useState<PreviewRenderState|null>(null);
  const current=rendered?.key===identity?rendered:null;
  useEffect(()=>{
    let disposed=false,cleanup:(()=>void)|undefined,failedScene:Scene|undefined;
    const publish=(status:PreviewRenderState['status'],message?:string)=>{
      if(disposed||desired.current!==identity)return;
      const state:PreviewRenderState={key:identity,status,...(message?{message}:{})};setRendered(state);callbacks.current.onRenderState?.(state);
    };
    // Leave React's commit before starting Babylon or reporting a frame. Cancel obsolete builds.
    const pending=window.setTimeout(()=>{
    if(disposed)return;
    publish('building');
    try{
    const element=canvas.current!,engine=engineRef.current??new Engine(element,true,{preserveDrawingBuffer:true}),scene=new Scene(engine);engineRef.current=engine;failedScene=scene;
    scene.clearColor=new Color4(.025,.045,.07,1);
    const {data,local,center,layer,fog,solar,exaggeration}=props,w=data.width,h=data.height,flat=!!props.flat&&!local,torus=!local&&!flat;
    const groundHeight=local&&data.geography?sampleWorldGeography(data.geography,center.x,center.y).elevation:local?data.elevations[wrapClimate(Math.floor(center.y),h)*w+wrapClimate(Math.floor(center.x),w)]!*data.altitudeCellRatio:0;
    const camera=new ArcRotateCamera('preview-camera',-Math.PI/2,local?.78:flat?.001:1.05,local?23:flat?Math.max(w/(engine.getRenderWidth()/Math.max(1,engine.getRenderHeight())),h)*.55:8,local?new Vector3(0,groundHeight+.4,0):Vector3.Zero(),scene);
    camera.minZ=.01;camera.maxZ=flat?Math.max(w,h)*6:200;camera.lowerRadiusLimit=local||flat?2:1.5;camera.upperRadiusLimit=flat?Math.max(w,h)*2:local?80:18;
    if(flat)camera.mode=Camera.ORTHOGRAPHIC_CAMERA;
    camera.wheelPrecision=flat?.6:local?8:35;camera.attachControl(element,false);activeCamera.current=camera;
    if(props.arrivalMap)camera.inputs.clear();
    const saved=poses.current.get(view);
    if(saved){camera.alpha=saved.alpha;camera.beta=saved.beta;camera.radius=saved.radius;camera.setTarget(saved.target.add(new Vector3(0,groundHeight-saved.groundHeight,0)),false,false,!!props.arrivalMap);}
    const neutral=new HemisphericLight('inspection-light',new Vector3(.3,1,.4),scene);neutral.intensity=solar&&!flat?0:1.15;neutral.groundColor=new Color3(.4,.4,.4);
    if(data.geography?.study){neutral.intensity=.65;const reliefLight=new DirectionalLight('study-relief-light',new Vector3(-.7,-1,.4),scene);reliefLight.intensity=.95;}
    const sun=new PointLight('preview-sun',Vector3.FromArray([...sunPosition(0)]),scene);sun.intensity=solar&&!flat?2.2:0;
    const material=new StandardMaterial('preview-shared-ground',scene);material.diffuseColor=Color3.White();material.specularColor=Color3.Black();material.backFaceCulling=false;
    if(layer!=='terrain'){material.disableLighting=true;material.emissiveColor=Color3.White();}
    const waterMaterial=new StandardMaterial('preview-shared-water',scene);waterMaterial.diffuseColor=new Color3(.08,.39,.57);waterMaterial.alpha=.72;waterMaterial.specularColor=new Color3(.08,.12,.14);waterMaterial.backFaceCulling=false;
    const positions:number[]=[],colors:number[]=[],indices:number[]=[],faceCells:number[]=[];
    const waterPositions:number[]=[],waterIndices:number[]=[],waterColors:number[]=[];
    const point=(x:number,y:number,z:number)=>{
      if(flat)return flatPreviewPoint(w,h,data.altitudeCellRatio,x,y,z,exaggeration);
      if(local)return [(x-center.x),z*data.altitudeCellRatio,(y-center.y)];
      const frame=torusFrame(x/w*Math.PI*2,y/h*Math.PI*2+Math.PI);
      // One altitude unit = one quarter of a canonical cell's minor-circle width.
      const offset=z*data.altitudeCellRatio*(Math.PI*2/h)*exaggeration;
      return frame.point.map((v,i)=>v+frame.normal[i]!*offset);
    };
    const idx=(x:number,y:number)=>wrapClimate(Math.floor(y),h)*w+wrapClimate(Math.floor(x),w);
    const color=(i:number):number[]=>{
      const z=data.elevations[i]!,v=data.exposure[i]!,humidity=data.humidity[i]!;
      if(layer==='water')return [.18,.23,.19,1];
      if(layer==='altitude')return [...altitudeColor(z),1];
      if(layer==='exposure')return [v*2.5,.25+v,.13,1];
      if(layer==='humidity')return [.12,humidity,.3+humidity*.6,1];
      if(layer==='accessibility'){
        if(!data.walkable[i])return [.2,.2,.23,1];
        const c=data.components[i]!;return [.25+((c*71)%100)/160,.65,.25+((c*37)%100)/180,1];
      }
      const forest=data.woodland[i]??0;

      return z<0?[.24,.28,.3,1]:[.35+z*.02-forest*.5,.46+z*.012-forest*.3,.24-forest*.2,1];
    };
    const quad=(corners:number[][],c:number[],cell:number)=>{
      const start=positions.length/3;for(const p of corners){positions.push(...p);colors.push(...c);}
      indices.push(start,start+1,start+2,start,start+2,start+3);faceCells.push(cell,cell);
    };
    // Canonical cells preserve every plateau edge; the bounded preview is at most 512 squared.
    // One cell per face also resolves torus curvature without T-junction cracks.
    const step=1;
    const x0=local?(data.geography?Math.floor((center.x-16)/32)*32:center.x-16):0,y0=local?(data.geography?Math.floor((center.y-16)/32)*32:center.y-16):0,x1=local?x0+(data.geography?64:32):w,y1=local?y0+(data.geography?64:32):h;
    const stairCells=new Set(data.stairs.flatMap(s=>naturalStairPairs(s,w,h).flat()));
    if(!data.geography)for(let y=y0;y<y1;y+=step)for(let x=x0;x<x1;x+=step){
      const i=idx(x,y),z=data.elevations[i]!,c=color(i);
      if(!local||!stairCells.has(i)){
        quad([point(x,y,z),point(x+step,y,z),point(x+step,y+step,z),point(x,y+step,z)],c,i);
      }
      for(const [dx,dy]of [[step,0],[0,step]]){
        const nz=data.elevations[idx(x+dx!,y+dy!)]!;
        if(nz!==z&&(!local||!stairCells.has(i)&&!stairCells.has(idx(x+dx!,y+dy!)))){
          const edge=dx?[point(x+step,y,z),point(x+step,y+step,z),point(x+step,y+step,nz),point(x+step,y,nz)]:
            [point(x,y+step,z),point(x+step,y+step,z),point(x+step,y+step,nz),point(x,y+step,nz)];
          quad(edge,c.map((v,j)=>j===3?v:v*.78),i);
        }
      }
      if(!data.hydrology&&layer==='terrain'&&data.terrainCodes[i]===2){
        const start=waterPositions.length/3;for(const p of [point(x,y,0),point(x+step,y,0),point(x+step,y+step,0),point(x,y+step,0)])waterPositions.push(...p);
        waterIndices.push(start,start+1,start+2,start,start+2,start+3);
      }
    }
    if(local)for(const stair of data.stairs){
      // Resolve toroidal coordinates near the inspected origin.
      const sx=center.x+wrapClimate(stair.x-center.x+w/2,w)-w/2,sy=center.y+wrapClimate(stair.y-center.y+h/2,h)-h/2;
      if(sx+(stair.direction===0?stair.length:stair.width)<=x0||sx>=x1||sy+(stair.direction===1?stair.length:stair.width)<=y0||sy>=y1)continue;
      for(const tread of stairProfile(stair,data)){
        const {a,b,height:z,riserAt,near,far}=tread;
        const c=layer==='terrain'?[.57,.52,.34,1]:color(stair.from);
        if(stair.direction===0){
          quad([point(sx+a,sy,z),point(sx+b,sy,z),point(sx+b,sy+stair.width,z),point(sx+a,sy+stair.width,z)],c,stair.from);
          quad([point(sx+riserAt,sy,near),point(sx+riserAt,sy+stair.width,near),point(sx+riserAt,sy+stair.width,far),point(sx+riserAt,sy,far)],c,stair.from);
          for(const edge of [sy,sy+stair.width]){
            const outside=data.elevations[idx(sx+(a+b)/2,edge===sy?edge-1:edge)]!;
            quad([point(sx+a,edge,stair.low),point(sx+b,edge,stair.low),point(sx+b,edge,z),point(sx+a,edge,z)],c,stair.from);
            if(outside>z)quad([point(sx+a,edge,z),point(sx+b,edge,z),point(sx+b,edge,outside),point(sx+a,edge,outside)],c,stair.from);
          }
        }else{
          quad([point(sx,sy+a,z),point(sx+stair.width,sy+a,z),point(sx+stair.width,sy+b,z),point(sx,sy+b,z)],c,stair.from);
          quad([point(sx,sy+riserAt,near),point(sx+stair.width,sy+riserAt,near),point(sx+stair.width,sy+riserAt,far),point(sx,sy+riserAt,far)],c,stair.from);
          for(const edge of [sx,sx+stair.width]){
            const outside=data.elevations[idx(edge===sx?edge-1:edge,sy+(a+b)/2)]!;
            quad([point(edge,sy+a,stair.low),point(edge,sy+b,stair.low),point(edge,sy+b,z),point(edge,sy+a,z)],c,stair.from);
            if(outside>z)quad([point(edge,sy+a,z),point(edge,sy+b,z),point(edge,sy+b,outside),point(edge,sy+a,outside)],c,stair.from);
          }
        }
      }
    }
    const make=(name:string,p:number[],ind:number[],mat:StandardMaterial,c?:number[])=>{
      const mesh=new Mesh(name,scene),v=new VertexData(),normals:number[]=[];
      if(p.length){VertexData.ComputeNormals(p,ind,normals);v.positions=p;v.indices=ind;v.normals=normals;if(c)v.colors=c;v.applyToMesh(mesh);}mesh.material=mat;return mesh;
    };
    if(data.geography){
      const buffers=props.mapGeometry??buildWorldGeometry(data,local,center,layer,point);
      for(const value of buffers.positions)positions.push(value);for(const value of buffers.colors)colors.push(value);
      for(const value of buffers.indices)indices.push(value);for(const value of buffers.faceCells)faceCells.push(value);
      for(const value of buffers.waterPositions)waterPositions.push(value);for(const value of buffers.waterIndices)waterIndices.push(value);
      waterMaterial.alpha=1;
      if(data.geography.geology){for(const value of buffers.waterColors)waterColors.push(value);waterMaterial.diffuseColor=Color3.White();}
    }
    const ground=make('candidate-ground',positions,indices,material,colors);material.wireframe=props.wireframe??false;
    if((local||flat)&&data.geography&&props.grid){
      const lines:Vector3[][]=[];
      const at=(x:number,y:number)=>Vector3.FromArray(point(x,y,(sampleWorldGeography(data.geography!,x,y).elevation+.012)*4));
      for(let y=y0;y<=y1;y+=flat?32:1)for(let x=x0;x<x1;x++)lines.push([at(x,y),at(x+1,y)]);
      for(let x=x0;x<=x1;x+=flat?32:1)for(let y=y0;y<y1;y++)lines.push([at(x,y),at(x,y+1)]);
      const overlay=MeshBuilder.CreateLineSystem('logical-grid',{lines},scene);overlay.color=new Color3(.55,.59,.48);overlay.alpha=.4;overlay.isPickable=false;
      const borders:Vector3[][]=[];
      for(let y=y0;y<y1;y++)for(let x=x0;x<=x1;x+=32)borders.push([at(x,y),at(x,y+1)]);
      for(let x=x0;x<x1;x++)for(let y=y0;y<=y1;y+=32)borders.push([at(x,y),at(x+1,y)]);
      const chunks=MeshBuilder.CreateLineSystem('chunk-borders',{lines:borders},scene);chunks.color=new Color3(1,.5,.12);chunks.isPickable=false;
    }
    const hydrology=data.hydrology&&(layer==='terrain'||layer==='water')?createHydrologyView(scene,data,local,center,point):null;
    const flowView=data.geography?.circulation&&layer==='water'?createGeographicFlowView(scene,data,local,center,point):null;
    const coordinates=(props.coordinates||props.chunks||data.geography?.study)&&data.geography?createStudyCoordinates(scene,data,local,center,point,!!props.coordinates):null;
    const water=make('candidate-water',waterPositions,waterIndices,waterMaterial,waterColors.length?waterColors:undefined);water.isPickable=false;
    scene.onPointerObservable.add(info=>{
      if(callbacks.current.arrivalMap)return;
      if(desired.current!==identity||info.type!==PointerEventTypes.POINTERPICK||info.pickInfo?.pickedMesh!==ground)return;
      const i=faceCells[info.pickInfo.faceId];if(i!==undefined)callbacks.current.onPick(i%w,Math.floor(i/w));
    });
    const mapMeshes:Mesh[]=[];let lastOverlay:PreviewMapOverlay|undefined;
    const diskMaterial=props.arrivalMap?new StandardMaterial('spawn-diagnostic-fill',scene):null;
    if(diskMaterial){diskMaterial.disableLighting=true;diskMaterial.emissiveColor=new Color3(.66,.83,.72);diskMaterial.alpha=.07;diskMaterial.backFaceCulling=false;}
    // This is the flat arrival map's projected UI layer. Render above the
    // geography without re-sampling thousands of elevations on pointer motion.
    // The authoritative red classification still comes from the terrain worker.
    const overlayPosition=(x:number,y:number)=>new Vector3(x-w/2,0,y-h/2);
    let presentedCursorAt:number|undefined,presentedDiagnosticAt:number|undefined;
    const updateMapOverlay=()=>{
      const overlay=callbacks.current.mapOverlay;if(overlay===lastOverlay)return;lastOverlay=overlay;
      element.dataset.mapSelectionSegments=String(overlay?.lines.filter(l=>l.color==='selection').length??0);
      element.dataset.mapDiskPoint=overlay?.disk?`${overlay.disk.x}:${overlay.disk.y}`:'';
      element.dataset.mapDiagnosticPoint=overlay?.diagnosticPoint?`${overlay.diagnosticPoint.x}:${overlay.diagnosticPoint.y}`:'';
      for(const mesh of mapMeshes)mesh.dispose();mapMeshes.length=0;
      if(overlay?.disk){
        const p:number[]=[],ind:number[]=[],sectors=48;
        for(const ox of [-w,0,w])for(const oy of [-h,0,h]){
          const cx=overlay.disk.x+ox,cy=overlay.disk.y+oy;if(cx+30<0||cy+30<0||cx-30>w||cy-30>h)continue;
          const vertex=(r:number,i:number)=>({x:cx+Math.cos(i/sectors*Math.PI*2)*r,y:cy+Math.sin(i/sectors*Math.PI*2)*r});
          for(let r=0;r<30;r+=3)for(let i=0;i<sectors;i++){
            const a=vertex(r,i),b=vertex(r+3,i),c=vertex(r+3,i+1),d=vertex(r,i+1);
            for(const triangle of [[a,b,c],[a,c,d]]){
              if(triangle.some(v=>v.x<0||v.x>w||v.y<0||v.y>h))continue;
              const start=p.length/3;for(const v of triangle){const point=overlayPosition(v.x,v.y);p.push(point.x,point.y-.06,point.z);}ind.push(start,start+1,start+2);
            }
          }
        }
        if(ind.length&&diskMaterial){const mesh=make('spawn-diagnostic-disk',p,ind,diskMaterial);mesh.isPickable=false;mesh.renderingGroupId=1;mapMeshes.push(mesh);}
      }
      for(const kind of ['diagnostic','error','selection','village'] as const){
        const lines=overlay?.lines.filter(l=>l.color===kind).map(l=>l.points.map(p=>overlayPosition(p.x,p.y)));if(!lines?.length)continue;
        const mesh=MeshBuilder.CreateLineSystem('spawn-'+kind,{lines},scene);mesh.isPickable=false;mesh.renderingGroupId=1;
        mesh.color=kind==='error'?new Color3(1,.28,.22):kind==='selection'?new Color3(1,.85,.3):kind==='village'?new Color3(1,1,.92):new Color3(.66,.83,.72);
        mesh.alpha=kind==='diagnostic'?.35:1;mapMeshes.push(mesh);
      }
    };
    const mapPoint=(e:PointerEvent|WheelEvent)=>{
      const rect=element.getBoundingClientRect(),aspect=engine.getAspectRatio(camera);
      return {x:camera.target.x+w/2+((e.clientX-rect.left)/rect.width-.5)*camera.radius*2*aspect,
        y:camera.target.z+h/2-((e.clientY-rect.top)/rect.height-.5)*camera.radius*2};
    };
    let drag:{id:number;x:number;y:number;target:Vector3;moved:boolean}|undefined;
    const down=(e:PointerEvent)=>{if(!callbacks.current.arrivalMap||e.button!==0)return;drag={id:e.pointerId,x:e.clientX,y:e.clientY,target:camera.target.clone(),moved:false};element.setPointerCapture(e.pointerId);element.focus();};
    const move=(e:PointerEvent)=>{
      if(!callbacks.current.arrivalMap)return;
      if(drag){const rect=element.getBoundingClientRect(),dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(Math.hypot(dx,dy)>5)drag.moved=true;
        if(drag.moved)camera.setTarget(drag.target.add(new Vector3(-dx/rect.width*camera.radius*2*engine.getAspectRatio(camera),0,dy/rect.height*camera.radius*2)),false,false,true);return;}
      const p=mapPoint(e);if(p.x>=0&&p.x<w&&p.y>=0&&p.y<h)callbacks.current.onHover?.(Math.round(p.x)%w,Math.round(p.y)%h,e.clientX,e.clientY);else callbacks.current.onLeave?.();
    };
    const up=(e:PointerEvent)=>{if(!drag||e.pointerId!==drag.id)return;const moved=drag.moved;drag=undefined;if(element.hasPointerCapture(e.pointerId))element.releasePointerCapture(e.pointerId);
      if(!moved){const p=mapPoint(e);if(p.x>=0&&p.x<w&&p.y>=0&&p.y<h)callbacks.current.onPick(Math.round(p.x)%w,Math.round(p.y)%h);}};
    const cancel=()=>{drag=undefined;callbacks.current.onLeave?.();};
    const wheel=(e:WheelEvent)=>{if(!callbacks.current.arrivalMap)return;e.preventDefault();const before=mapPoint(e);zoom(e.deltaY>0?1.15:1/1.15);const after=mapPoint(e);camera.setTarget(camera.target.add(new Vector3(before.x-after.x,0,before.y-after.y)),false,false,true);};
    const key=(e:KeyboardEvent)=>{if(!callbacks.current.arrivalMap)return;if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Enter','Escape'].includes(e.key)){e.preventDefault();callbacks.current.onMapKey?.(e.key);}};
    if(props.arrivalMap){element.addEventListener('pointerdown',down);element.addEventListener('pointermove',move);element.addEventListener('pointerup',up);element.addEventListener('pointercancel',cancel);element.addEventListener('pointerleave',cancel);element.addEventListener('wheel',wheel,{passive:false});element.addEventListener('keydown',key);}
    const torusTrees:Mesh[]=[],stoneMeshes:Mesh[]=[];
    if((local||data.geography)&&layer==='terrain'){
      const trunkMaterial=new StandardMaterial('preview-tree-trunks',scene);trunkMaterial.diffuseColor=new Color3(.26,.16,.08);trunkMaterial.specularColor=Color3.Black();
      const foliageMaterial=new StandardMaterial('preview-tree-foliage',scene);foliageMaterial.diffuseColor=new Color3(.13,.29,.11);foliageMaterial.specularColor=Color3.Black();
      const trunks=MeshBuilder.CreateCylinder('preview-trunk-lot',{height:.7,diameter:.12,tessellation:local?5:3},scene);
      const foliage=MeshBuilder.CreateCylinder('preview-foliage-lot',{height:1.15,diameterBottom:.65,diameterTop:0,tessellation:local?6:3},scene);
      trunks.material=trunkMaterial;foliage.material=foliageMaterial;trunks.isPickable=false;foliage.isPickable=false;
      const trunkMatrices:number[]=[],foliageMatrices:number[]=[];
      const colors:number[]=[];
      const addTree=(px:number,pz:number,base:number,size=1,crown=1,shade=1)=>{
        const matrix=(offset:number)=>flat
          ? Matrix.Scaling(size*crown,size,size*crown).multiply(Matrix.Translation(px-w/2,base*exaggeration+offset*size,pz-h/2))
          : local
          ? Matrix.Scaling(size*crown,size,size*crown).multiply(Matrix.Translation(px-center.x,base+offset*size,pz-center.y))
          : torusTreeMatrix(px,pz,base,offset,w,h,exaggeration,size,crown);
        trunkMatrices.push(...matrix(.35).asArray());foliageMatrices.push(...matrix(1).asArray());
        colors.push(shade,shade,shade,1);
      };
      if(data.forest){
        for(const tree of data.forest.trees){
          const px=local?x0+wrapClimate(tree.x-x0,w):tree.x;
          const pz=local?y0+wrapClimate(tree.y-y0,h):tree.y;
          if(local&&(px<x0||px>=x1||pz<y0||pz>=y1))continue;
          addTree(px,pz,tree.elevation,tree.size,tree.crown,tree.shade);
        }
      }else{
        for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){const i=idx(x,y);if(data.woodland[i]){
          const px=x+.25+climateHash(data.seed,wrapClimate(x,w),wrapClimate(y,h),91)*.5,pz=y+.25+climateHash(data.seed,wrapClimate(x,w),wrapClimate(y,h),8293)*.5;
          const sample=data.geography?sampleWorldGeography(data.geography,px,pz):null;
          if(sample&&sample.depth>0)continue;
          addTree(px,pz,sample?sample.elevation:data.elevations[i]!*data.altitudeCellRatio);
        }}
      }
      foliage.thinInstanceSetBuffer('color',new Float32Array(colors),4,true);
      trunks.thinInstanceSetBuffer('matrix',new Float32Array(trunkMatrices),16,true);
      foliage.thinInstanceSetBuffer('matrix',new Float32Array(foliageMatrices),16,true);
      // Buffers stay static; preserve native bounds updates when the torus phase changes.
      trunks.setEnabled(trunkMatrices.length>0);foliage.setEnabled(foliageMatrices.length>0);if(torus)torusTrees.push(trunks,foliage);
    }
    if(data.stoneSites&&layer==='terrain'){
      const geometry=buildWorldOutcrops(data,local,center,point);
      const material=new StandardMaterial('preview-stone-material',scene);material.diffuseColor=Color3.White();material.specularColor=Color3.Black();material.wireframe=props.wireframe??false;
      const stone=make('preview-stone-outcrops',geometry.positions,geometry.indices,material,geometry.colors);
      stone.isPickable=false;stone.receiveShadows=true;stoneMeshes.push(stone);
      stone.setEnabled(geometry.indices.length>0);if(torus)torusTrees.push(stone);
    }
    const shadows=solar&&!flat?new ShadowGenerator(512,sun):null;
    if(shadows){shadows.addShadowCaster(ground);for(const stone of stoneMeshes)shadows.addShadowCaster(stone);ground.receiveShadows=true;shadows.bias=.002;shadows.normalBias=.01;}
    const weather=fog&&torus?new WeatherMap(scene,String(data.seed),data.seed,data.geography?.circulation):null;
    const fogVolume=weather?new TorusFog(scene):null;
    const instrument=new SceneInstrumentation(scene);instrument.captureFrameTime=true;
    const samples:number[]=[];let lastRotation=NaN;let nextStats=performance.now()+2000;
    let firstFrame=true;
    const render=()=>{
      if(disposed||desired.current!==identity)return;
      if(flat){const aspect=engine.getAspectRatio(camera);camera.orthoTop=camera.radius;camera.orthoBottom=-camera.radius;camera.orthoLeft=-camera.radius*aspect;camera.orthoRight=camera.radius*aspect;}
      if(callbacks.current.arrivalMap){updateMapOverlay();element.dataset.mapOverlayDisk=callbacks.current.mapOverlay?.disk?'1':'0';element.dataset.mapOverlayMeshes=String(mapMeshes.length);
        element.dataset.mapTarget=`${camera.target.x}:${camera.target.z}`;element.dataset.mapRadius=String(camera.radius);element.dataset.mapAspect=String(engine.getAspectRatio(camera));element.dataset.mapAngles=`${camera.alpha}:${camera.beta}`;}
      const phase=callbacks.current.cycleDegrees/360*Math.PI*2,rotation=cyclePhases(phase).torus,p=sunPosition(cyclePhases(phase).sun);
      if(torus){if(rotation!==lastRotation){ground.rotation.y=-rotation;water.rotation.y=-rotation;for(const trees of torusTrees)trees.rotation.y=-rotation;lastRotation=rotation;}sun.position.copyFromFloats(...p);}
      else if(solar&&!flat){const light=illumination(center.x/w*Math.PI*2,center.y/h*Math.PI*2+Math.PI,phase);sun.position.set(light.localDirection[0]*50,light.localDirection[1]*50,light.localDirection[2]*50);sun.intensity=light.lit?2.2:0;}
      coordinates?.update(callbacks.current.center);if(coordinates)for(const mesh of coordinates.meshes){mesh.setEnabled(!!(callbacks.current.coordinates||callbacks.current.chunks));mesh.rotation.y=torus?-rotation:0;}
      flowView?.update(phase);if(flowView)flowView.mesh.rotation.y=torus?-rotation:0;
      element.dataset.flowCount=String(flowView?.count??0);element.dataset.flowPhase=String(phase);
      hydrology?.update(phase,performance.now()/1000,camera.radius,solar);
      weather?.update(COSMOLOGY.epochMs+callbacks.current.cycleDegrees/360*combinedPeriod());fogVolume?.update(phase,sun.position,weather);scene.render();
      if(callbacks.current.arrivalMap){
        const overlay=lastOverlay,now=performance.now();
        if(overlay?.requestedAt!==undefined&&overlay.requestedAt!==presentedCursorAt){presentedCursorAt=overlay.requestedAt;element.dataset.mapCursorFrameMs=(now-presentedCursorAt).toFixed(1);}
        if(overlay?.diagnosticRequestedAt!==undefined&&overlay.diagnosticRequestedAt!==presentedDiagnosticAt){presentedDiagnosticAt=overlay.diagnosticRequestedAt;element.dataset.mapDiskFrameMs=(now-presentedDiagnosticAt).toFixed(1);}
      }
      element.dataset.weatherTime=String(weather?.paintedAt??'');
      element.dataset.renderPhase=String(callbacks.current.cycleDegrees);
      // Inactive decorative batches may have no geometry. Wait for the visible
      // arrival ground shader, rather than all unused meshes in the scene.
      if(firstFrame&&(!callbacks.current.arrivalMap||ground.isReady(true))){firstFrame=false;publish('ready');}
      samples.push(instrument.frameTimeCounter.current);if(samples.length>120)samples.shift();
      if(performance.now()>nextStats){
        nextStats=performance.now()+2000;const sorted=[...samples].sort((a,b)=>a-b);
        callbacks.current.onStats({renderKey:identity,fps:engine.getFps(),median:sorted[Math.floor(sorted.length*.5)]??0,p95:sorted[Math.floor(sorted.length*.95)]??0,
          draws:engine._drawCalls.current,meshes:scene.getActiveMeshes().length,indices:scene.getActiveIndices(),residentVertices:scene.getTotalVertices(),materials:scene.materials.length,
          textures:scene.textures.length,backend:'WebGL '+engine.webGLVersion,fogPasses:fogVolume?3:0});
      }
    };
    const renderFrame=()=>{try{render();}catch(error){engine.stopRenderLoop(renderFrame);publish('error',error instanceof Error?error.message:String(error));}};
    engine.runRenderLoop(renderFrame);
    const resize=()=>engine.resize();window.addEventListener('resize',resize);
    cleanup=()=>{element.removeEventListener('pointerdown',down);element.removeEventListener('pointermove',move);element.removeEventListener('pointerup',up);element.removeEventListener('pointercancel',cancel);element.removeEventListener('pointerleave',cancel);element.removeEventListener('wheel',wheel);element.removeEventListener('keydown',key);activeCamera.current=null;poses.current.set(view,{alpha:camera.alpha,beta:camera.beta,radius:camera.radius,target:camera.target.clone(),groundHeight});window.removeEventListener('resize',resize);engine.stopRenderLoop(renderFrame);flowView?.dispose();hydrology?.dispose();fogVolume?.dispose();weather?.dispose();shadows?.dispose();instrument.dispose();scene.dispose();};
    }catch(error){engineRef.current?.stopRenderLoop();failedScene?.dispose();publish('error',error instanceof Error?error.message:String(error));}
    },0);
    return()=>{disposed=true;window.clearTimeout(pending);cleanup?.();};
  },[identity,props.data,props.flat,props.local,props.local?props.center.x:0,props.local?props.center.y:0,props.layer,props.fog,props.solar,props.exaggeration,props.wireframe,props.grid]);
  useEffect(()=>()=>{engineRef.current?.dispose();engineRef.current=null;},[]);
  return <div className="generator-render" data-render-status={current?.status??'building'} data-render-key={current?.status==='ready'?identity:''} data-candidate={props.candidateKey} data-view={view} data-layer={props.layer}>
    <p role="status" className="generator-render-status">{current?.status==='ready'?`Rendu affiché · seed ${props.data.seed} · ${view==='map'?'carte complète':view==='local'?'inspection locale':'tore'} · ${props.layer} · ${props.local?1:props.exaggeration}×`:current?.status==='error'?`Échec du rendu : ${current.message}`:'Préparation du rendu…'}</p>
    <div className="generator-zoom"><button aria-label="Zoom avant" onClick={()=>zoom(.75)}>+</button><button aria-label="Zoom arrière" onClick={()=>zoom(1/.75)}>−</button>{props.arrivalMap&&<button onClick={resetMap}>Vue globale</button>}</div><canvas ref={canvas} tabIndex={props.arrivalMap?0:undefined} aria-label={props.arrivalMap?'Carte du monde. Flèches pour inspecter, Entrée pour sélectionner.':'Aperçu 3D du candidat'} className="generator-canvas" style={{visibility:current?.status==='ready'?'visible':'hidden'}}/></div>;
}
