import { cyclePhases, sunPosition } from '@arbestra/contracts/cosmology';
import { Vector2, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { Scene } from '@babylonjs/core/scene';
import { basinTide, drainageDirection, type GeneratedLandscape } from '@arbestra/contracts';

const vertexSource=`
precision highp float;
attribute vec3 position;
attribute vec3 tideDirection;
attribute vec2 uv;
attribute vec3 flow;
attribute float waterHeight;
uniform mat4 worldViewProjection;
uniform float tide;
uniform vec2 dimensions;
uniform vec3 solarPosition;
uniform float rotation;
varying vec2 vUV;
varying vec3 vFlow;
varying float vHeight;
varying float vSunlight;
void main(){
 vUV=uv;vFlow=flow;vHeight=waterHeight;
 float u=uv.x/dimensions.x*6.28318530718+rotation,v=uv.y/dimensions.y*6.28318530718+3.14159265359;
 vec3 normal=vec3(cos(v)*cos(u),sin(v),cos(v)*sin(u));
 vec3 surface=vec3((2.4+cos(v))*cos(u),sin(v),(2.4+cos(v))*sin(u));
 vec3 direction=normalize(solarPosition-surface);
 vSunlight=max(0.0,dot(direction,normal));
 vec2 marine=vec2(dot(direction,vec3(-sin(u),0.0,cos(u))),dot(direction,vec3(-sin(v)*cos(u),cos(v),-sin(v)*sin(u))));
 if(flow.z>.5&&flow.z<1.5)vFlow.xy=marine;
 if(flow.z>2.5)vFlow.xy=.25*flow.xy+.75*marine;
 gl_Position=worldViewProjection*vec4(position+tide*tideDirection,1.0);
}
`;
const fragmentSource=`
precision highp float;
varying vec2 vUV;
varying vec3 vFlow;
varying float vHeight;
varying float vSunlight;
uniform float time;
uniform float foam;
uniform float detail;
uniform float light;
uniform float solar;
void main(){
 vec2 direction=vFlow.xy;
 vec2 p=vUV-direction*time*.65;
 float ripple=.6*sin(p.x*9.0+p.y*5.0+.6*sin(p.y*3.0-time*.2))+.3*sin(p.x*3.0-p.y*7.0);
 if(vFlow.z>1.5&&vFlow.z<2.5)ripple=sin(vHeight*50.0+time*8.0)*sin((p.x+p.y)*37.0);
 if(detail<.5)ripple=0.0;
 vec3 water=mix(vec3(.045,.29,.40),vec3(.13,.57,.65),.5+.15*ripple);
 if(vFlow.z>1.5&&vFlow.z<2.5)water=mix(water,vec3(.32,.66,.73),.6);
 vec3 froth=mix(vec3(.55,.79,.81),vec3(.94,.98,.95),step(.35,ripple));
 gl_FragColor=vec4(mix(water,froth,foam)*light*mix(1.0,.3+.7*vSunlight,solar),mix(.84,.76,foam));
}
`;
/** Two shared GPU batches. Tide displaces vertices in the shader, without rebuilding the scene. */
export function createHydrologyView(scene:Scene,data:GeneratedLandscape,local:boolean,
  center:{x:number;y:number},point:(x:number,y:number,z:number)=>number[]){
  const hydro=data.hydrology!,sunVector=new Vector3(0,0,0);
  const makeBatch=(name:string,foam:boolean)=>{
    const p:number[]=[],indices:number[]=[],uv:number[]=[],flow:number[]=[],directions:number[]=[],heights:number[]=[];
    const quad=(corners:number[][],levels:number[],tidal:boolean[],direction:readonly[number,number],marine:boolean,fall=false,estuary=false)=>{
      const start=p.length/3;
      for(let k=0;k<4;k++){
        const [x,y]=corners[k]!,z=levels[k]!,a=point(x!,y!,z),b=point(x!,y!,z+1);
        p.push(...a);directions.push(...b.map((v,j)=>tidal[k]?v-a[j]!:0));uv.push(x!,y!);flow.push(...direction,fall?2:estuary?3:marine?1:0);heights.push(z);
      }
      indices.push(start,start+1,start+2,start,start+2,start+3);
    };
    const finish=()=>{
      const mesh=new Mesh(name,scene),v=new VertexData();v.positions=p;v.indices=indices;v.uvs=uv;v.applyToMesh(mesh);
      mesh.setVerticesData('waterHeight',heights,false,1);
      mesh.setVerticesData('tideDirection',directions,false,3);mesh.setVerticesData('flow',flow,false,3);
      const material=new ShaderMaterial(name+'-material',scene,{vertexSource,fragmentSource},{
        attributes:['position','tideDirection','uv','flow','waterHeight'],uniforms:['worldViewProjection','time','tide','foam','detail','light','dimensions','solarPosition','rotation','solar'],needAlphaBlending:true});
      material.backFaceCulling=false;material.setFloat('foam',foam?1:0);material.setFloat('detail',local?1:0);mesh.alphaIndex=foam?1:0;material.setFloat('light',1);material.setFloat('time',0);material.setFloat('tide',0);material.setVector2('dimensions',new Vector2(data.width,data.height));material.setVector3('solarPosition',sunVector);material.setFloat('rotation',0);material.setFloat('solar',0);
      mesh.material=material;mesh.isPickable=false;
      // Shader displacement stays within a quarter unit; prevent tight bounds clipping a moving edge.
      mesh.alwaysSelectAsActiveMesh=true;
      return {mesh,material};
    };
    return {quad,finish};
  };
  const water=makeBatch('hydrology-water',false),foam=makeBatch('hydrology-foam',true);
  const index=(x:number,y:number)=>((y%data.height+data.height)%data.height)*data.width+(x%data.width+data.width)%data.width;
  const minX=local?Math.floor(center.x)-16:0,minY=local?Math.floor(center.y)-16:0,maxX=local?minX+32:data.width,maxY=local?minY+32:data.height;
  const tidal=(id:number)=>{const r=hydro.reaches[id]!;return r.kind==='sea'||r.tideAnchor!==undefined;};
  for(let y=minY;y<maxY;y++)for(let x=minX;x<maxX;x++){
    const i=index(x,y),id=hydro.reachByCell[i]!;if(id<0)continue;
    const r=hydro.reaches[id]!,z=r.surface,t=tidal(id),direction=drainageDirection(data,i);
    water.quad([[x,y],[x+1,y],[x+1,y+1],[x,y+1]],[z,z,z,z],[t,t,t,t],direction,t,false,t&&r.kind==='river');
  }
  for(const fall of hydro.waterfalls)for(const lane of fall.lanes??[fall]){
    let x=lane.cell%data.width,y=Math.floor(lane.cell/data.width);
    if(local){x=center.x+((x-center.x+data.width*1.5)%data.width)-data.width/2;y=center.y+((y-center.y+data.height*1.5)%data.height)-data.height/2;}
    if(x<minX||x>=maxX||y<minY||y>=maxY)continue;
    const nx=lane.nextCell%data.width,ny=Math.floor(lane.nextCell/data.width);
    const dx=((nx-lane.cell%data.width+data.width*1.5)%data.width)-data.width/2;
    const dy=((ny-Math.floor(lane.cell/data.width)+data.height*1.5)%data.height)-data.height/2;
    const a=dx?[x+(dx>0?1:0),y]:[x,y+(dy>0?1:0)],b=dx?[a[0]!,y+1]:[x+1,a[1]!];
    for(const edge of [a,b]){edge[0]=edge[0]!+dx*.008;edge[1]=edge[1]!+dy*.008;}
    const t=tidal(fall.to);
    water.quad([a,b,b,a],[fall.top,fall.top,fall.bottom,fall.bottom],[false,false,t,t],[0,-1],false,true);
    if(local){
      const off=.18;
      foam.quad([a,b,[b[0]!+dx*off,b[1]!+dy*off],[a[0]!+dx*off,a[1]!+dy*off]],
        new Array(4).fill(fall.bottom+.015),[t,t,t,t],[dx,dy],false);
    }
  }
  const batches=[water.finish(),...(local?[foam.finish()]:[])],sea=hydro.reaches.find(r=>r.kind==='sea');
  return {update(phase:number,time:number,radius:number,solar:boolean){
    const tide=sea?basinTide(data,sea,phase):0,phases=cyclePhases(phase);sunVector.set(...sunPosition(phases.sun));
    for(const batch of batches){batch.mesh.rotation.y=local?0:-phases.torus;batch.material.setFloat('tide',tide);batch.material.setFloat('time',time);batch.material.setFloat('light',1);batch.material.setFloat('solar',solar?1:0);batch.material.setFloat('rotation',phases.torus);batch.material.setVector3('solarPosition',sunVector);}
    // Fine foam is only useful nearby. Global view never creates it.
    if(batches[1])batches[1].mesh.setEnabled(radius<14);
  },dispose(){for(const {mesh,material}of batches){mesh.dispose();material.dispose();}}};
}
