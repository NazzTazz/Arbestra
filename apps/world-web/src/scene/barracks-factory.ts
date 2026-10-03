import {Mesh} from '@babylonjs/core/Meshes/mesh';
import {MeshBuilder} from '@babylonjs/core/Meshes/meshBuilder';
import {VertexData} from '@babylonjs/core/Meshes/mesh.vertexData';
import {Vector3,Quaternion} from '@babylonjs/core/Maths/math.vector';
import {Color3} from '@babylonjs/core/Maths/math.color';
import {StandardMaterial} from '@babylonjs/core/Materials/standardMaterial';
import {buildingPlan,HALL_RECIPE,type BuildingPlan} from './building-plan';
import {TimberThatch,timberBeamGeometry,hallStoneCrossRotation} from './timber-thatch';
import type {VillageState} from '@arbestra/contracts';
import {normalize} from './world-space';

/** Development recipe only: find an empty, level 2x5 patch in the real snapshot. */
export function barracksPreviewPlacement(state:VillageState){
  const {world,region,village}=state,key=(x:number,y:number)=>`${normalize(x,world.widthCells)}:${normalize(y,world.heightCells)}`;
  const occupied=new Set(state.cells.filter(c=>c.footprint||c.building).map(c=>key(c.cellX,c.cellY)));
  const features=new Set(region.features.map(f=>key(f.cellX,f.cellY)));
  const candidates=[];
  for(let dy=-20;dy<=16;dy++)for(let dx=-20;dx<=19;dx++)candidates.push({dx,dy,distance:Math.hypot(dx+.5,dy+2)});
  candidates.sort((a,b)=>a.distance-b.distance);
  for(const {dx,dy} of candidates){const cellX=normalize(village.anchorCellX+dx,world.widthCells),cellY=normalize(village.anchorCellY+dy,world.heightCells),heights:number[]=[];
    let valid=true;
    for(let y=-1;y<=5&&valid;y++)for(let x=-1;x<=2;x++){
      const cx=normalize(cellX+x,world.widthCells),cy=normalize(cellY+y,world.heightCells),rx=normalize(cx-region.originCellX,world.widthCells),ry=normalize(cy-region.originCellY,world.heightCells);
      if(rx>=region.width||ry>=region.height||occupied.has(key(cx,cy))||features.has(key(cx,cy))||region.terrainCodes[ry*region.width+rx]!==1){valid=false;break;}
      if(x>=0&&x<2&&y>=0&&y<5)heights.push(region.elevations[ry*region.width+rx]??0);
    }
    if(valid&&Math.max(...heights)-Math.min(...heights)<=1)return {cellX,cellY,base:Math.max(...heights)*.025+.02};
  }
  return null;
}

export interface BarracksPlan {cellsWide:2;cellsDeep:5;pavilions:{plan:BuildingPlan;x:number;z:number}[];court:{width:number;depth:number};}
/** Two 2×1 pavilions at opposite ends of a 2×5 footprint, a 2×3 courtyard. */
export function barracksPlan(phase:'finished'|'works'='finished'):BarracksPlan {
  return {cellsWide:2,cellsDeep:5,court:{width:5,depth:7.5},pavilions:[0,4].map((row,i)=>({
    plan:buildingPlan({id:`barracks-pavilion-${i}`,anchor:{cellX:0,cellY:row},cells:[{cellX:0,cellY:row},{cellX:1,cellY:row}],world:{widthCells:32,heightCells:32},quarterTurns:1,phase,
      recipe:{...HALL_RECIPE,id:'barracks-pavilion',modules:[6,16],courses:10,entrance:{...HALL_RECIPE.entrance,face:i===0?'-x':'+x'},windows:{'-x':[2],'+x':[2],'-z':[1],'+z':[1]}}}),x:0,z:(row-2)*2.5})),};
}
export function buildBarracks(root:Mesh,kit:TimberThatch,phase:'finished'|'works'='finished') {
  const scene=kit.scene,plan=barracksPlan(phase),parts=new Map<StandardMaterial,Mesh[]>();
  const add=(m:Mesh,material:StandardMaterial)=>{m.material=material;if(material===kit.stone)m.setVerticesData('color',new Array(m.getTotalVertices()*4).fill(1));const batch=parts.get(material)??[];batch.push(m);parts.set(material,batch);return m;};
  const point=(x:number,y:number,z:number)=>new Vector3(x,y,z);
  const beam=(name:string,a:Vector3,b:Vector3,w:number,h=w,material=kit.wood)=>{
    const mesh=new Mesh(name,scene);timberBeamGeometry(Vector3.Distance(a,b),w,h,material===kit.stone,1).applyToMesh(mesh);
    mesh.position=Vector3.Center(a,b);mesh.rotationQuaternion=new Quaternion();Quaternion.FromUnitVectorsToRef(Vector3.Up(),b.subtract(a).normalize(),mesh.rotationQuaternion);return add(mesh,material);
  };
  for(const pavilion of plan.pavilions){const mesh=new Mesh(pavilion.plan.id,scene);mesh.parent=root;mesh.position.set(pavilion.x,.02,pavilion.z);mesh.rotation.y=pavilion.plan.rotation;kit.build(mesh,pavilion.plan);}
  // Compacted courtyard with a deterministic ragged, fading edge into the lawn.
  const soil=new StandardMaterial('barracks-packed-earth',scene);soil.diffuseColor=Color3.FromHexString('#c1a47d');soil.specularColor=Color3.Black();soil.zOffset=-2;
  const positions:number[]=[],colours:number[]=[],indices:number[]=[],normals:number[]=[];
  const noise=(i:number)=>{const n=Math.sin(i*127.1+31.7)*43758.5453;return n-Math.floor(n);};
  const vertex=(x:number,z:number,alpha:number,shade:number)=>{const index=positions.length/3;positions.push(x,.008,z);normals.push(0,1,0);colours.push(shade,shade,shade,alpha);return index;};
  const nx=12,nz=24;
  for(let iz=0;iz<=nz;iz++)for(let ix=0;ix<=nx;ix++)vertex(-2.1+ix*4.2/nx,-4.16+iz*8.32/nz,1,.92+noise(ix+iz*37)*.08);
  for(let iz=0;iz<nz;iz++)for(let ix=0;ix<nx;ix++){const a=iz*(nx+1)+ix,b=a+1,c=a+nx+1,d=c+1;indices.push(a,c,b,b,c,d);}
  const boundary:number[]=[];
  for(let ix=0;ix<=nx;ix++)boundary.push(ix);
  for(let iz=1;iz<=nz;iz++)boundary.push(iz*(nx+1)+nx);
  for(let ix=nx-1;ix>=0;ix--)boundary.push(nz*(nx+1)+ix);
  for(let iz=nz-1;iz>0;iz--)boundary.push(iz*(nx+1));
  const outside=boundary.map((index,i)=>{const x=positions[index*3]!,z=positions[index*3+2]!,width=.12+noise(i*13)*.22;
    return vertex(x+ (Math.abs(x)>2.09?Math.sign(x)*width:0),z+(Math.abs(z)>4.15?Math.sign(z)*width:0),0,.96);
  });
  for(let i=0;i<boundary.length;i++){const j=(i+1)%boundary.length;indices.push(boundary[i]!,outside[i]!,boundary[j]!,boundary[j]!,outside[i]!,outside[j]!);}
  // Babylon's left-handed front-face winding points the patch toward the sky.
  for(let i=0;i<indices.length;i+=3){const b=indices[i+1]!;indices[i+1]=indices[i+2]!;indices[i+2]=b;}
  const earth=new Mesh('barracks-courtyard-earth',scene),data=new VertexData();data.positions=positions;data.indices=indices;data.normals=normals;data.colors=colours;data.applyToMesh(earth);
  earth.hasVertexAlpha=true;earth.material=soil;earth.parent=root;earth.receiveShadows=true;earth.isPickable=false;
  root.onDisposeObservable.add(()=>soil.dispose());
  // Side walls meet the pavilion sides. A single east gate opens into the court.
  for(const side of [-1,1])for(let row=0;row<3;row++){
    const ranges=side===1?[[-4.16,-.55],[.55,4.16]]:[[-4.16,4.16]];
    for(const [start,end] of ranges){let z=start!;while(z<end!-.001){const next=Math.min(end!,z+(z===start&&row%2?.14:.28));
      const stone=beam('barracks-court-wall',point(side*2.17,(row+.5)*.14,z+.0015),point(side*2.17,(row+.5)*.14,next-.0015),.137,.137,kit.stone);
      stone.rotationQuaternion=hallStoneCrossRotation('z').multiply(stone.rotationQuaternion!);z=next;
    }}
  }
  if(phase==='finished'){
    // Light lean-to: posts, longitudinal purlins and small transverse rafters.
    // Front posts frame the firing lanes rather than standing in front of targets.
    for(const z of [-3.15,-1.05,1.05,3.15])beam('barracks-shelter-post',point(-.7,0,z),point(-.7,1.85,z),.065);
    for(let i=0;i<8;i++){const z=-3.15+i*6.3/7;beam('barracks-shelter-post',point(-2.05,0,z),point(-2.05,1.6,z),.065);}
    for(const x of [-2.05,-.7])beam('barracks-shelter-purlin',point(x,x< -1?1.6:1.85,-3.25),point(x,x< -1?1.6:1.85,3.25),.07);
    for(let z=-3.2;z<=3.2;z+=.8)beam('barracks-shelter-rafter',point(-2.16,1.62,z),point(-.59,1.91,z),.045);
    for(let i=0;i<27;i++){
      const z=-3.25+(i+.5)*6.5/27;
      const board=MeshBuilder.CreateBox('barracks-shelter-board',{width:Math.hypot(1.65,.3),height:.025,depth:6.5/27-.005},scene);
      board.position.set(-1.375,1.79,z);board.rotation.z=Math.atan2(.3,1.65);add(board,kit.boards);
    }
    for(let i=0;i<7;i++){const a=-3.15+i*6.3/7,b=a+6.3/7;
      beam('barracks-back-brace',point(-2.05,.48,a!),point(-2.05,1.48,b!),.04);
      beam('barracks-back-brace',point(-2.05,1.48,a!),point(-2.05,.48,b!),.04);
    }
    for(const z of [-3.15,3.15]){
      beam('barracks-side-brace',point(-2.05,.48,z),point(-.7,1.48,z),.04);
      beam('barracks-side-brace',point(-2.05,1.48,z),point(-.7,.48,z),.04);
    }
    const ivory=new StandardMaterial('barracks-target-ivory',scene);ivory.diffuseColor=Color3.FromHexString('#f6ecd6');ivory.specularColor=Color3.Black();
    const red=new StandardMaterial('barracks-target-red',scene);red.diffuseColor=Color3.FromHexString('#b35038');red.specularColor=Color3.Black();
    for(const z of [-2.1,0,2.1]){
      // Two feet below the front face; one central rear leg supports the target's back.
      for(const [dx,dz] of [[.15,-.22],[.15,.22],[-.35,0]])beam('barracks-target-tripod',point(-1.6+dx!,0,z+dz!),point(-1.63,.95,z),.035);
      // Overlapping shallow discs avoid the detached, stepped cone silhouette.
      for(const [diameter,offset,material] of [[.55,0,ivory],[.37,.002,red],[.2,.004,ivory],[.07,.006,red]] as const){
        const disc=MeshBuilder.CreateCylinder('barracks-target',{diameter,height:.014,tessellation:32},scene);disc.rotation.z=-Math.PI/2;disc.position.set(-1.6+offset,.95,z);add(disc,material);
      }
    }
    // Target materials belong to this compound, whereas the kit materials are shared.
    root.onDisposeObservable.add(()=>{ivory.dispose();red.dispose();});
  }
  for(const [material,batch] of parts){const merged=Mesh.MergeMeshes(batch,true,true);if(!merged)throw new Error('Barracks geometry merge failed');merged.name=`barracks-${material.name}`;merged.material=material;merged.parent=root;merged.receiveShadows=true;}
  return root;
}
