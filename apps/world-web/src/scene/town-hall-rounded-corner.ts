import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { Quaternion } from '@babylonjs/core/Maths/math.vector';
import { facePoint, type BuildingPlan } from './building-plan';
import { TimberThatch, timberBeamGeometry } from './timber-thatch';
import { attachFrostedGlass } from './frosted-glass';
import { BuildingGeometry } from './building-geometry';

type Point={x:number;z:number};
const RADIUS=.70;
function clip(points:Point[],distance:(p:Point)=>number):Point[]{
  const out:Point[]=[];
  for(let i=0;i<points.length;i++){
    const a=points[i]!,b=points[(i+1)%points.length]!,da=distance(a),db=distance(b);
    if(da<=1e-8)out.push(a);
    if((da<0)!==(db<0)){const t=da/(da-db);out.push({x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t});}
  }return out;
}
function block(root:Mesh,kit:TimberThatch,x:number,z:number,bottom:number,length:number,height:number,thickness:number,angle=0,shade=1){
  if(length<.006||thickness<.006)return;
  const mesh=new Mesh('market-rounded-stone',kit.scene);
  (kit.lod?BuildingGeometry.box('rounded-wall-block',{height:length,width:height,depth:thickness}).data:timberBeamGeometry(length,height,thickness,true,kit.stoneProfile?.segments??1,.1,kit.stoneProfile?.radiusRatio??.04)).applyToMesh(mesh);
  mesh.position.set(x,bottom+height/2,z);
  mesh.rotationQuaternion=Quaternion.RotationYawPitchRoll(angle,0,-Math.PI/2);
  mesh.setVerticesData('color',Array.from({length:mesh.getTotalVertices()},()=>[shade,shade,shade,1]).flat());
  mesh.parent=root;mesh.material=kit.stone;mesh.receiveShadows=true;return mesh;
}
/** Closed ordinary blocks, trimmed only where they cross the curve or a window jamb. */
function trimmedBlock(root:Mesh,kit:TimberThatch,polygon:Point[],bottom:number,height:number,shade:number,softEdges=false){
  polygon=polygon.filter((p,i)=>{const a=polygon[(i+polygon.length-1)%polygon.length]!;return Math.hypot(p.x-a.x,p.z-a.z)>1e-7;});
  if(polygon.length<3)return;
  const bevel=softEdges&&!kit.lod?Math.min(height*.12,...polygon.map((p,i)=>{const next=polygon[(i+1)%polygon.length]!;return Math.hypot(next.x-p.x,next.z-p.z)/6;})):0;
  if(bevel){
    polygon=polygon.flatMap((p,i)=>{
      const previous=polygon[(i+polygon.length-1)%polygon.length]!,next=polygon[(i+1)%polygon.length]!;
      const toward=(q:Point)=>{const d=Math.hypot(q.x-p.x,q.z-p.z);return {x:p.x+(q.x-p.x)*bevel*2/d,z:p.z+(q.z-p.z)*bevel*2/d};};
      const a=toward(previous),b=toward(next);
      return Array.from({length:4},(_,j)=>{const t=j/3,u=1-t;return {x:u*u*a.x+2*u*t*p.x+t*t*b.x,z:u*u*a.z+2*u*t*p.z+t*t*b.z};});
    });
  }
  const positions:number[]=[],indices:number[]=[],normals:number[]=[],uvs:number[]=[],colors:number[]=[];
  const area=polygon.reduce((sum,a,i)=>{const b=polygon[(i+1)%polygon.length]!;return sum+a.x*b.z-b.x*a.z;},0);
  const sign=Math.sign(area);
  const face=(points:number[][],out:number[])=>{
    const ps=points.flat(),is:number[]=[];
    for(let i=1;i<points.length-1;i++)is.push(0,i,i+1);
    const ns:number[]=[];VertexData.ComputeNormals(ps,is,ns);
    if(ns[0]!*out[0]!+ns[1]!*out[1]!+ns[2]!*out[2]!<0){for(let i=0;i<is.length;i+=3)[is[i+1],is[i+2]]=[is[i+2]!,is[i+1]!];VertexData.ComputeNormals(ps,is,ns);}
    const offset=positions.length/3;positions.push(...ps);normals.push(...ns);indices.push(...is.map(i=>i+offset));
    for(const [x,y,z] of points){uvs.push(x!+z!,y!);colors.push(shade,shade,shade,1);}
  };
  const cx=polygon.reduce((sum,p)=>sum+p.x,0)/polygon.length,cz=polygon.reduce((sum,p)=>sum+p.z,0)/polygon.length;
  const levels=bevel?[[0,bevel],[bevel*.293,bevel*.293],[bevel,0],[height-bevel,0],[height-bevel*.293,bevel*.293],[height,bevel]]:[[0,0],[height,0]];
  const rings=levels.map(([y,inset])=>polygon.map(p=>{const d=Math.hypot(p.x-cx,p.z-cz)||1;return [p.x+(cx-p.x)*inset!/d,bottom+y!,p.z+(cz-p.z)*inset!/d];}));
  face(rings[0]!,[0,-1,0]);face(rings[rings.length-1]!,[0,1,0]);
  for(let r=0;r<rings.length-1;r++)for(let i=0;i<polygon.length;i++){const a=polygon[i]!,b=polygon[(i+1)%polygon.length]!,j=(i+1)%polygon.length;
    face([rings[r]![i]!,rings[r]![j]!,rings[r+1]![j]!,rings[r+1]![i]!],[sign*(b.z-a.z),bevel?(r<2?-bevel:r>2?bevel:0):0,sign*(a.x-b.x)]);
  }
  const mesh=new Mesh('market-rounded-trimmed-stone',kit.scene),data=new VertexData();Object.assign(data,{positions,indices,normals,uvs,colors});data.applyToMesh(mesh);
  mesh.parent=root;mesh.material=kit.stone;mesh.receiveShadows=true;return mesh;
}
function curveClip(polygon:Point[],cx:number,cz:number,radius=RADIUS){
  for(let segment=0;segment<12&&polygon.length;segment++){
    const theta=-Math.PI/2+(segment+.5)*Math.PI/24;
    polygon=clip(polygon,p=>Math.cos(theta)*(p.x-cx)+Math.sin(theta)*(p.z-cz)-radius*Math.cos(Math.PI/48));
  }
  return polygon;
}
/** Disjoint pieces: only the corner quadrant follows the curve. */
function cornerPieces(polygon:Point[],cx:number,cz:number){
  const left=clip(polygon,p=>p.x-cx),right=clip(polygon,p=>cx-p.x);
  return [left,clip(right,p=>cz-p.z),curveClip(clip(right,p=>p.z-cz),cx,cz)].filter(p=>p.length>=3);
}
function mortarWalls(root:Mesh,kit:TimberThatch,plan:BuildingPlan,cx:number,cz:number,limit:number,storefront=false){
  const parts:Mesh[]=[],thickness=plan.recipe.module.thickness-.012;
  for(const face of ['-x','+x','-z','+z'] as const){
    const half=face.endsWith('x')?plan.depth/2:plan.width/2,dist=(face.endsWith('x')?plan.width/2:plan.depth/2)-plan.recipe.module.thickness/2;
    const openings=plan.openings.filter(o=>o.face===face);
    const heights=[0,limit,...(storefront?[.28,1.4].filter(y=>y<limit):[]),...openings.flatMap(o=>[o.bottom,o.top]).filter(y=>y>0&&y<limit)].sort((a,b)=>a-b);
    for(let i=0;i<heights.length-1;i++){
      const bottom=heights[i]!,top=heights[i+1]!;if(top-bottom<1e-8)continue;
      const cuts=openings.filter(o=>o.bottom<top&&o.top>bottom).sort((a,b)=>a.left-b.left);
      let start=-half;
      for(const end of [...cuts.map(o=>({left:o.left,right:o.right})),{left:half,right:half}]){
        if(end.left>start){const polygon=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([u,v])=>{const p=facePoint(face,u===-1?start:end.left,0,dist+v!*thickness/2);return {x:p.x,z:p.z};});
          const pieces=storefront&&bottom>=.28-1e-8&&top<=1.4+1e-8?[clip(polygon,p=>p.x-cx),clip(clip(polygon,p=>cx-p.x),p=>cz-p.z)]:cornerPieces(polygon,cx,cz);
          for(const piece of pieces){const mesh=trimmedBlock(root,kit,piece,bottom,top-bottom,.84);if(mesh)parts.push(mesh);}
        }start=Math.max(start,end.right);
      }
    }
  }
  return parts;
}
/** End the straight walls on the two tangent lines; keep closed cut blocks. */
export function prepareRoundedCorner(plan:BuildingPlan){
  const cx=plan.width/2-RADIUS,cz=-plan.depth/2+RADIUS,cut: Array<{polygon:Point[];bottom:number;height:number;shade:number}>=[];
  plan.stones=plan.stones.filter(stone=>{
    const dx=(stone.axis==='x'?stone.length:stone.thickness)/2,dz=(stone.axis==='z'?stone.length:stone.thickness)/2;
    const polygon=[{x:stone.x-dx,z:stone.z-dz},{x:stone.x+dx,z:stone.z-dz},{x:stone.x+dx,z:stone.z+dz},{x:stone.x-dx,z:stone.z+dz}];
    if(!polygon.some(p=>p.x>cx&&p.z<cz))return true;
    const result=clip(polygon,stone.axis==='x'?p=>p.x-cx:p=>cz-p.z);
    cut.push({polygon:result,bottom:stone.y-stone.height/2,height:stone.height,shade:stone.shade});return false;
  });
  return {cx,cz,cut};
}
/** Clip floor/roof batches to an inscribed quarter-circle without changing other corners. */
function clipBatch(mesh:Mesh,cx:number,cz:number){
  const source=mesh.getVerticesData('position'),normals=mesh.getVerticesData('normal'),uv=mesh.getVerticesData('uv'),color=mesh.getVerticesData('color'),index=mesh.getIndices();
  if(!source||!index)return;
  type Vertex={p:number[];n:number[];uv:number[];color:number[]};
  const positions:number[]=[],ns:number[]=[],uvs:number[]=[],colors:number[]=[],indices:number[]=[];
  const read=(i:number):Vertex=>({p:Array.from(source.slice(i*3,i*3+3)),n:normals?Array.from(normals.slice(i*3,i*3+3)):[0,1,0],uv:uv?Array.from(uv.slice(i*2,i*2+2)):[0,0],color:color?Array.from(color.slice(i*4,i*4+4)):[1,1,1,1]});
  const lerp=(a:Vertex,b:Vertex,t:number):Vertex=>{
    const mix=(x:number[],y:number[])=>x.map((v,i)=>v+(y[i]!-v)*t);
    return {p:mix(a.p,b.p),n:mix(a.n,b.n),uv:mix(a.uv,b.uv),color:mix(a.color,b.color)};
  };
  const cut=(polygon:Vertex[],distance:(v:Vertex)=>number)=>{
    const out:Vertex[]=[];for(let k=0;k<polygon.length;k++){const a=polygon[k]!,b=polygon[(k+1)%polygon.length]!,da=distance(a),db=distance(b);if(da<=1e-8)out.push(a);if((da<0)!==(db<0))out.push(lerp(a,b,da/(da-db)));}return out;
  };
  const emit=(polygon:Vertex[])=>{for(let k=1;k<polygon.length-1;k++)for(const v of [polygon[0]!,polygon[k]!,polygon[k+1]!]){indices.push(positions.length/3);positions.push(...v.p);ns.push(...v.n);uvs.push(...v.uv);colors.push(...v.color);}};
  for(let i=0;i<index.length;i+=3){const original=[read(index[i]!),read(index[i+1]!),read(index[i+2]!)];
    emit(cut(original,v=>v.p[0]!-cx));
    const right=cut(original,v=>cx-v.p[0]!);emit(cut(right,v=>cz-v.p[2]!));
    let polygon=cut(right,v=>v.p[2]!-cz);
    for(let segment=0;segment<12&&polygon.length;segment++){
      const theta=-Math.PI/2+(segment+.5)*Math.PI/24,nx=Math.cos(theta),nz=Math.sin(theta),limit=RADIUS*Math.cos(Math.PI/48),out:Vertex[]=[];
      const distance=(v:Vertex)=>nx*(v.p[0]!-cx)+nz*(v.p[2]!-cz)-limit;
      for(let k=0;k<polygon.length;k++){const a=polygon[k]!,b=polygon[(k+1)%polygon.length]!,da=distance(a),db=distance(b);
        if(da<=1e-8)out.push(a);if((da<0)!==(db<0))out.push(lerp(a,b,da/(da-db)));
      }polygon=out;
    }
    emit(polygon);
  }
  const data=new VertexData();Object.assign(data,{positions,indices,normals:ns,uvs});if(color)data.colors=colors;data.applyToMesh(mesh);mesh.refreshBoundingInfo();
}
export function finishRoundedCorner(root:Mesh,kit:TimberThatch,plan:BuildingPlan,corner:ReturnType<typeof prepareRoundedCorner>,withWindow=true,parapet=true,storefront=false){
  for(const mesh of root.getChildMeshes())clipBatch(mesh as Mesh,corner.cx,corner.cz);
  const limit=plan.phase==='works'?Math.ceil(plan.height*.65/plan.recipe.module.height)*plan.recipe.module.height:plan.height;
  const stones:Mesh[]=[];
  const mortar=mortarWalls(root,kit,plan,corner.cx,corner.cz,limit,storefront);
  for(const stone of corner.cut)if(stone.bottom+stone.height/2<=limit&&stone.polygon.length>=3){
    const xs=stone.polygon.map(p=>p.x),zs=stone.polygon.map(p=>p.z),left=Math.min(...xs),right=Math.max(...xs),front=Math.min(...zs),back=Math.max(...zs);
    const mesh=block(root,kit,(left+right)/2,(front+back)/2,stone.bottom,right-left,stone.height,back-front,0,stone.shade);if(mesh)stones.push(mesh);
  }
  const angularWindow=Math.asin(.14/RADIUS),mid=-Math.PI/4;
  const row=(bottom:number,height:number,course:number,window:boolean)=>{
    if(storefront&&bottom>=.28-1e-8&&bottom<1.4-1e-8)return;
    const p=(radius:number,theta:number)=>({x:corner.cx+radius*Math.cos(theta),z:corner.cz+radius*Math.sin(theta)});
    for(let i=0;i<12;i++){
      const a=-Math.PI/2+i*Math.PI/24,b=a+Math.PI/24;
      const polygon=[p(RADIUS-.006,a),p(RADIUS-.006,b),p(RADIUS-plan.recipe.module.thickness+.006,b),p(RADIUS-plan.recipe.module.thickness+.006,a)];
      for(const side of window?[1,-1]:[0]){
        const piece=side?clip(polygon,p=>side*Math.SQRT1_2*(p.x-corner.cx+p.z-corner.cz)+.14):polygon;
        const mesh=trimmedBlock(root,kit,piece,bottom,height,.84);if(mesh)mortar.push(mesh);
      }
    }
    const radius=RADIUS-plan.recipe.module.thickness/2,step=.14/radius;
    const knots=[-Math.PI/2,0];
    for(let a=-Math.PI/2+(course%2?step/2:step);a<0;a+=step)knots.push(a);
    if(window)knots.push(mid-angularWindow,mid+angularWindow);knots.sort((a,b)=>a-b);
    for(let i=0;i<knots.length-1;i++){
      const a=knots[i]!,b=knots[i+1]!;if(b-a<1e-7||window&&(a+b)/2>mid-angularWindow&&(a+b)/2<mid+angularWindow)continue;
      const theta=(a+b)/2;
      const x=corner.cx+radius*Math.cos(theta),z=corner.cz+radius*Math.sin(theta),length=(b-a)*radius-.003,depth=plan.recipe.module.thickness-.003;
      const tx=-Math.sin(theta),tz=Math.cos(theta),nx=Math.cos(theta),nz=Math.sin(theta);
      let polygon=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([u,v])=>({x:x+u!*length/2*tx+v!*depth/2*nx,z:z+u!*length/2*tz+v!*depth/2*nz}));
      polygon=curveClip(polygon,corner.cx,corner.cz);
      if(window){const side=theta<mid?1:-1;polygon=clip(polygon,p=>side*Math.SQRT1_2*(p.x-corner.cx+p.z-corner.cz)+.14);}
      const mesh=trimmedBlock(root,kit,polygon,bottom+.0015,height-.003,.96+(course%3)*.015,!!kit.stoneProfile);if(mesh)stones.push(mesh);
    }
  };
  const h=.07,courses=Math.round(plan.height/h);
  for(let course=0;course<courses;course++)if((course+.5)*h<=limit)row(course*h,h,course,withWindow&&course*h>=.14-1e-8&&course*h<1.12-1e-8);
  if(plan.phase==='finished'){row(plan.height,.08,courses,false);if(parapet)row(plan.height+.08,h,courses+1,false);}
  // Merge in local coordinates so the floor transform is applied only once.
  for(const stone of stones)stone.parent=null;
  if(stones.length){const merged=Mesh.MergeMeshes(stones,true,true);if(merged){merged.name='market-rounded-masonry';merged.parent=root;merged.material=kit.stone;merged.receiveShadows=true;}}
  for(const mesh of mortar)mesh.parent=null;
  if(mortar.length){const merged=Mesh.MergeMeshes(mortar,true,true);if(merged){merged.name='market-wall-mortar';merged.parent=root;merged.material=kit.stone;merged.receiveShadows=true;}}
  if(plan.phase==='works'||!withWindow)return;
  const nx=Math.SQRT1_2,nz=-nx,x=corner.cx+(RADIUS-.02)*nx,z=corner.cz+(RADIUS-.02)*nz;
  const frame=new Mesh('market-rounded-window',kit.scene);frame.parent=root;frame.position.set(x,.14,z);frame.rotation.y=-Math.PI/4;
  // Local +Z points into the room: frames sit in the wall rather than projecting out.
  const box=(name:string,x:number,y:number,width:number,height:number,depth:number,wood=false,d=.06)=>{
    const mesh=wood?MeshBuilder.CreateBox(name,{width,height,depth},kit.scene):new Mesh(name,kit.scene);
    if(!wood)timberBeamGeometry(height,width,depth,true,kit.stoneProfile?.segments??1,.1,kit.stoneProfile?.radiusRatio??.04).applyToMesh(mesh);
    mesh.position.set(x,y,d);mesh.parent=frame;mesh.material=wood?kit.wood:kit.stone;mesh.receiveShadows=true;
  };
  for(const side of [-1,1]){box('rounded-window-stone-jamb',side*.1375,.49,.065,.98,.14);box('rounded-window-wood-trim',side*.1275,.5075,.065,.945,.025,true,.008);}
  box('rounded-window-lintel',0,1.015,.42,.07,.14);box('rounded-window-stone-sill',0,.0175,.42,.035,.14);
  box('rounded-window-sill',0,.0175,.38,.035,.12,true,.01);box('rounded-window-wood-trim',0,1.005,.38,.05,.025,true,.008);
  const glass=MeshBuilder.CreatePlane('market-rounded-window-glass',{width:.19,height:.945},kit.scene);glass.parent=frame;glass.position.set(0,.5075,0);attachFrostedGlass(glass);
}
