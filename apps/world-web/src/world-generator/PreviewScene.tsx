import {createStudyCoordinates} from './study-coordinates';
import {createGeographicFlowView} from './geographic-flow-view';
import {flatPreviewPoint,renderIdentity,type PreviewView} from './preview-inspection';
import {Camera} from '@babylonjs/core/Cameras/camera';
import { buildWorldOutcrops } from './world-outcrops';
import { torusTreeMatrix } from './world-tree-transform';
import { buildWorldGeometry } from './world-geography-mesh';
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
interface Props {chunks?:boolean;coordinates?:boolean;flat?:boolean;candidateKey?:string;onRenderState?:(state:PreviewRenderState)=>void;grid?:boolean;wireframe?:boolean;data:GeneratedLandscape;local:boolean;center:{x:number;y:number};layer:PreviewLayer;fog:boolean;solar:boolean;exaggeration:number;cycleDegrees:number;
 onPick:(x:number,y:number)=>void;onStats:(stats:PreviewStats)=>void}
export function PreviewScene(props:Props){
  const canvas=useRef<HTMLCanvasElement>(null),callbacks=useRef(props);callbacks.current=props;
  const activeCamera=useRef<ArcRotateCamera|null>(null),engineRef=useRef<Engine|null>(null);
  const zoom=(factor:number)=>{const camera=activeCamera.current;if(camera)camera.radius=Math.max(camera.lowerRadiusLimit??0,Math.min(camera.upperRadiusLimit??Infinity,camera.radius*factor));};
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
    const saved=poses.current.get(view);
    if(saved){camera.alpha=saved.alpha;camera.beta=saved.beta;camera.radius=saved.radius;camera.setTarget(saved.target.add(new Vector3(0,groundHeight-saved.groundHeight,0)));}
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
      const buffers=buildWorldGeometry(data,local,center,layer,point);
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
      if(desired.current!==identity||info.type!==PointerEventTypes.POINTERPICK||info.pickInfo?.pickedMesh!==ground)return;
      const i=faceCells[info.pickInfo.faceId];if(i!==undefined)callbacks.current.onPick(i%w,Math.floor(i/w));
    });
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
      const phase=callbacks.current.cycleDegrees/360*Math.PI*2,rotation=cyclePhases(phase).torus,p=sunPosition(cyclePhases(phase).sun);
      if(torus){if(rotation!==lastRotation){ground.rotation.y=-rotation;water.rotation.y=-rotation;for(const trees of torusTrees)trees.rotation.y=-rotation;lastRotation=rotation;}sun.position.copyFromFloats(...p);}
      else if(solar&&!flat){const light=illumination(center.x/w*Math.PI*2,center.y/h*Math.PI*2+Math.PI,phase);sun.position.set(light.localDirection[0]*50,light.localDirection[1]*50,light.localDirection[2]*50);sun.intensity=light.lit?2.2:0;}
      coordinates?.update(callbacks.current.center);if(coordinates)for(const mesh of coordinates.meshes){mesh.setEnabled(!!(callbacks.current.coordinates||callbacks.current.chunks));mesh.rotation.y=torus?-rotation:0;}
      flowView?.update(phase);if(flowView)flowView.mesh.rotation.y=torus?-rotation:0;
      element.dataset.flowCount=String(flowView?.count??0);element.dataset.flowPhase=String(phase);
      hydrology?.update(phase,performance.now()/1000,camera.radius,solar);
      weather?.update(COSMOLOGY.epochMs+callbacks.current.cycleDegrees/360*combinedPeriod());fogVolume?.update(phase,sun.position,weather);scene.render();
      element.dataset.weatherTime=String(weather?.paintedAt??'');
      element.dataset.renderPhase=String(callbacks.current.cycleDegrees);
      if(firstFrame){firstFrame=false;publish('ready');}
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
    cleanup=()=>{activeCamera.current=null;poses.current.set(view,{alpha:camera.alpha,beta:camera.beta,radius:camera.radius,target:camera.target.clone(),groundHeight});window.removeEventListener('resize',resize);engine.stopRenderLoop(renderFrame);flowView?.dispose();hydrology?.dispose();fogVolume?.dispose();weather?.dispose();shadows?.dispose();instrument.dispose();scene.dispose();};
    }catch(error){engineRef.current?.stopRenderLoop();failedScene?.dispose();publish('error',error instanceof Error?error.message:String(error));}
    },0);
    return()=>{disposed=true;window.clearTimeout(pending);cleanup?.();};
  },[identity,props.data,props.flat,props.local,props.local?props.center.x:0,props.local?props.center.y:0,props.layer,props.fog,props.solar,props.exaggeration,props.wireframe,props.grid]);
  useEffect(()=>()=>{engineRef.current?.dispose();engineRef.current=null;},[]);
  return <div className="generator-render" data-render-status={current?.status??'building'} data-render-key={current?.status==='ready'?identity:''} data-candidate={props.candidateKey} data-view={view} data-layer={props.layer}>
    <p role="status" className="generator-render-status">{current?.status==='ready'?`Rendu affiché · seed ${props.data.seed} · ${view==='map'?'carte complète':view==='local'?'inspection locale':'tore'} · ${props.layer} · ${props.local?1:props.exaggeration}×`:current?.status==='error'?`Échec du rendu : ${current.message}`:'Préparation du rendu…'}</p>
    <div className="generator-zoom"><button aria-label="Zoom avant" onClick={()=>zoom(.75)}>+</button><button aria-label="Zoom arrière" onClick={()=>zoom(1/.75)}>−</button></div><canvas ref={canvas} aria-label="Aperçu 3D du candidat" className="generator-canvas" style={{visibility:current?.status==='ready'?'visible':'hidden'}}/></div>;
}
