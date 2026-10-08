import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { Vector3, Matrix } from '@babylonjs/core/Maths/math.vector';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { SceneInstrumentation } from '@babylonjs/core/Instrumentation/sceneInstrumentation';
import { PointerEventTypes } from '@babylonjs/core/Events/pointerEvents';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import '@babylonjs/core/Culling/ray';
import { geoHash, geoWrap, sampleGeography, projectGeographyCell, type GeographyDescriptor } from '@arbestra/contracts/geography-prototype';
import type { GeographyBuffers, GeographyChunk } from './geography-mesh';

export interface GeographyDisplay { grid:boolean; wire:boolean; borders:boolean; flow:boolean; water:boolean }
export interface GeographyMetrics { median:number; p95:number; cpu:number; draws:number; meshes:number; vertices:number; width:number; height:number; backend:string; renderer:string }
export interface GeographyResult { geography:GeographyDescriptor; chunks:GeographyChunk[]; durationMs:number }
export type CellFacts=ReturnType<typeof projectGeographyCell>&{x:number;y:number;height:number};

export function createGeographyScene(canvas:HTMLCanvasElement,onMetrics:(m:GeographyMetrics)=>void,onPick:(f:CellFacts)=>void){
  const engine=new Engine(canvas,true,{preserveDrawingBuffer:true}),scene=new Scene(engine);
  scene.clearColor=new Color4(.065,.09,.11,1);
  const camera=new ArcRotateCamera('geography-camera',-Math.PI/2-.22,.85,51,new Vector3(32,0,16),scene);
  camera.minZ=.05;camera.maxZ=300;camera.lowerRadiusLimit=6;camera.upperRadiusLimit=110;camera.wheelPrecision=8;
  camera.panningSensibility=70;camera.attachControl(canvas,false);
  const ambient=new HemisphericLight('sky',new Vector3(0,1,0),scene);ambient.intensity=.72;
  const sun=new DirectionalLight('sun',new Vector3(.35,-1,.5),scene);sun.intensity=1.05;
  const terrainMaterial=new StandardMaterial('geography-ground',scene);terrainMaterial.diffuseColor=Color3.White();terrainMaterial.specularColor=Color3.Black();
  // Same inexpensive advected ripple idea as hydrology-view; no reflection pass.
  const waterMaterial=new ShaderMaterial('geography-water',scene,{
    vertexSource:`precision highp float;attribute vec3 position;attribute vec2 flow;uniform mat4 worldViewProjection;uniform mat4 world;varying vec2 vWorld;varying vec2 vFlow;void main(){vWorld=(world*vec4(position,1.)).xz;vFlow=flow;gl_Position=worldViewProjection*vec4(position,1.);}`,
    fragmentSource:`precision highp float;varying vec2 vWorld;varying vec2 vFlow;uniform float time;void main(){vec2 p=vWorld-vFlow*time*.28;float ripple=.6*sin(p.x*8.+p.y*5.+.6*sin(p.y*3.-time*.2))+.3*sin(p.x*3.-p.y*7.);vec3 water=mix(vec3(.075,.29,.33),vec3(.23,.48,.49),.5+.17*ripple);gl_FragColor=vec4(water,1.);}`
  },{attributes:['position','flow'],uniforms:['worldViewProjection','world','time']});
  waterMaterial.backFaceCulling=false;
  const instrumentation=new SceneInstrumentation(scene);instrumentation.captureFrameTime=true;
  let content:Mesh[]=[],ground:Mesh[]=[],waterMeshes:Mesh[]=[],grid:Mesh|null=null,borders:Mesh|null=null,flow:Mesh|null=null;
  let geography:GeographyDescriptor|null=null,originX=0,display:GeographyDisplay={grid:false,wire:false,borders:false,flow:false,water:true};
  let frames:number[]=[],last=performance.now(),reportAt=last,settle=last+1000;
  function applyDisplay(){for(const mesh of waterMeshes)mesh.setEnabled(display.water);terrainMaterial.wireframe=display.wire;waterMaterial.wireframe=display.wire;grid?.setEnabled(display.grid);borders?.setEnabled(display.borders);flow?.setEnabled(display.flow);frames=[];settle=performance.now()+500;}
  function makeMesh(name:string,b:GeographyBuffers,x:number,y:number,isWater=false){
    const mesh=new Mesh(name,scene),data=new VertexData(),normals:number[]=[];
    data.positions=b.positions;data.indices=b.indices;data.colors=b.colors;
    VertexData.ComputeNormals(b.positions,b.indices,normals);data.normals=normals;data.applyToMesh(mesh);
    mesh.setVerticesData('flow',b.flow,false,2);mesh.material=isWater?waterMaterial:terrainMaterial;
    mesh.position.set(x-originX,0,y);mesh.isPickable=!isWater;return mesh;
  }
  const lines=(name:string,paths:Vector3[][],color:Color3)=>{const m=MeshBuilder.CreateLineSystem(name,{lines:paths},scene);m.color=color;m.isPickable=false;content.push(m);return m;};
  function load(result:GeographyResult){
    for(const mesh of content)mesh.dispose();content=[];ground=[];waterMeshes=[];
    geography=result.geography;originX=result.chunks[0]!.x;
    for(const chunk of result.chunks){
      const g=makeMesh(`terrain-${chunk.x}`,chunk.ground,chunk.x,chunk.y);ground.push(g);content.push(g);
      if(chunk.water.indices.length){const w=makeMesh(`water-${chunk.x}`,chunk.water,chunk.x,chunk.y,true);content.push(w);waterMeshes.push(w);}
    }
    const at=(x:number,y:number,lift=.055)=>{
      const s=sampleGeography(geography!,x+originX,y);return new Vector3(x,Math.max(s.elevation,s.waterLevel??-Infinity)+lift,y);
    };
    const gridLines:Vector3[][]=[];
    for(let x=0;x<=64;x++)gridLines.push(Array.from({length:65},(_,i)=>at(x,i*.5)));
    for(let y=0;y<=32;y++)gridLines.push(Array.from({length:129},(_,i)=>at(i*.5,y)));
    grid=lines('logical-grid',gridLines,new Color3(.72,.75,.56));
    const edges=[...Array.from({length:3},(_,i)=>Array.from({length:65},(_,j)=>at(i*32,j*.5,.09))),
      ...[0,32].map(y=>Array.from({length:129},(_,i)=>at(i*.5,y,.09)))];
    borders=lines('chunk-boundaries',edges,new Color3(1,.47,.16));
    const arrows:Vector3[][]=[];
    for(const reach of geography.reaches)for(let i=4;i<reach.axis.length;i+=8){
      const a=reach.axis[i-1]!,b=reach.axis[i]!,x=b[0]-originX,y=b[1];if(x<0||x>64||y<0||y>32)continue;
      const length=Math.hypot(b[0]-a[0],b[1]-a[1]),dx=(b[0]-a[0])/length,dy=(b[1]-a[1])/length;
      arrows.push([at(x-dx,y-dy,.13),at(x+dx,y+dy,.13)],
        [at(x+dx*.3-dy*.4,y+dy*.3+dx*.4,.13),at(x+dx,y+dy,.13),at(x+dx*.3+dy*.4,y+dy*.3-dx*.4,.13)]);
    }
    flow=lines('drainage',arrows,new Color3(.82,.94,.91));
    // Decorative fixtures only. No NaturalFeature or persistent resource is created.
    const transforms:number[]=[];
    for(let i=0;i<210;i++){
      const x=geoHash(geography.options.seed,i,0,26719)*64,y=geoHash(geography.options.seed,i,0,98413)*32;
      const s=sampleGeography(geography,x+originX,y);if(s.waterLevel!==null||s.shoreDistance<2||s.rock>.12||y>23)continue;
      const scale=.6+.65*geoHash(geography.options.seed,i,0,718937);
      transforms.push(...Matrix.Scaling(scale,scale,scale).multiply(Matrix.Translation(x,s.elevation,y)).toArray());
    }
    const trees=[MeshBuilder.CreateCylinder('tree-trunks',{height:.65,diameter:.13,tessellation:5},scene),
      MeshBuilder.CreateCylinder('tree-crowns',{height:1.35,diameterTop:0,diameterBottom:.75,tessellation:5},scene)];
    trees[0]!.bakeTransformIntoVertices(Matrix.Translation(0,.32,0));trees[1]!.bakeTransformIntoVertices(Matrix.Translation(0,1.0,0));
    for(let i=0;i<trees.length;i++){
      const tree=trees[i]!,mat=new StandardMaterial('tree-material',scene);mat.diffuseColor=i?new Color3(.23,.34,.12):new Color3(.32,.23,.14);mat.specularColor=Color3.Black();
      tree.material=mat;tree.onDisposeObservable.add(()=>mat.dispose());tree.isPickable=false;
      tree.thinInstanceSetBuffer('matrix',new Float32Array(transforms),16);content.push(tree);
    }
    applyDisplay();last=performance.now();settle=last+1000;
  }
  scene.onPointerObservable.add(info=>{
    if(info.type!==PointerEventTypes.POINTERPICK||!geography)return;
    const pick=scene.pick(scene.pointerX,scene.pointerY,m=>ground.includes(m as Mesh));
    if(!pick?.pickedPoint)return;
    const x=geoWrap(Math.floor(pick.pickedPoint.x+originX),geography.width),y=geoWrap(Math.floor(pick.pickedPoint.z),geography.height);
    onPick({...projectGeographyCell(geography,x,y),x,y,height:sampleGeography(geography,pick.pickedPoint.x+originX,pick.pickedPoint.z).elevation});
  });
  engine.runRenderLoop(()=>{
    const now=performance.now();waterMaterial.setFloat('time',now/1000);scene.render();
    if(now>settle)frames.push(now-last);last=now;
    if(now-reportAt>1500&&frames.length>10){
      const sorted=frames.slice().sort((a,b)=>a-b),info=engine.getGlInfo();
      onMetrics({median:sorted[Math.floor(sorted.length*.5)]!,p95:sorted[Math.floor(sorted.length*.95)]!,
        cpu:instrumentation.frameTimeCounter.current,draws:instrumentation.drawCallsCounter.current,meshes:scene.getActiveMeshes().length,
        vertices:scene.getTotalVertices(),width:engine.getRenderWidth(),height:engine.getRenderHeight(),backend:`WebGL ${engine.webGLVersion}`,renderer:info.renderer});
      frames=[];reportAt=now;
    }
  });
  const resize=new ResizeObserver(()=>engine.resize());resize.observe(canvas);
  return {load,setDisplay(value:GeographyDisplay){display=value;applyDisplay();},pose(name:string){
    camera.alpha=-Math.PI/2-.22;
    if(name==='rock'){camera.setTarget(new Vector3(19-originX,1,5));camera.radius=22;camera.beta=.95;}
    else if(name==='river'){camera.setTarget(new Vector3(30-originX,.2,16));camera.radius=28;camera.beta=.85;}
    else {camera.setTarget(new Vector3(32,0,16));camera.radius=51;camera.beta=.85;}
    frames=[];settle=performance.now()+500;
  },dispose(){resize.disconnect();instrumentation.dispose();scene.dispose();engine.dispose();}};
}
