import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { Vector3, Quaternion } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import type { Scene } from '@babylonjs/core/scene';
import { facePoint, type BuildingPlan } from './building-plan';
import {timberDoor} from './timber-door';

export function hallWallCourse(row:number,axis:'x'|'z'){
  const halfX=1.245,halfZ=1.135,thickness=.16;
  const through=(row%2===0)===(axis==='x');
  return {limit:(axis==='x'?halfX:halfZ)-(through?0:thickness),fixed:(axis==='x'?halfZ:halfX)-thickness/2,thickness};
}

export function hallStoneCrossRotation(axis:'x'|'z',vertical=false){
  return axis==='z'?Quaternion.RotationAxis(vertical?Vector3.Up():Vector3.Forward(),Math.PI/2):Quaternion.Identity();
}

export function timberBeamGeometry(length:number,w:number,h:number,rounded=false,segments=3){
  const d=new VertexData(),bevel=Math.min(w,h,length)*(rounded?.04:.1);
      let ring=[[-w/2+bevel,-h/2],[w/2-bevel,-h/2],[w/2,-h/2+bevel],[w/2,h/2-bevel],[w/2-bevel,h/2],[-w/2+bevel,h/2],[-w/2,h/2-bevel],[-w/2,-h/2+bevel]];
      if(rounded){ring=[];const centres=[[w/2-bevel,-h/2+bevel],[w/2-bevel,h/2-bevel],[-w/2+bevel,h/2-bevel],[-w/2+bevel,-h/2+bevel]];
        for(let corner=0;corner<4;corner++)for(let step=0;step<=segments;step++){const angle=(-.5+corner*.5+step/(segments*2))*Math.PI;
          ring.push([centres[corner]![0]!+Math.cos(angle)*bevel,centres[corner]![1]!+Math.sin(angle)*bevel]);}}
      const positions:number[]=[],indices:number[]=[],uvs:number[]=[];
      const endScale=rounded?.98:.8;
      const rings=[{y:-length/2,scale:endScale},{y:-length/2+bevel,scale:1},{y:length/2-bevel,scale:1},{y:length/2,scale:endScale}];
      for(let r=0;r<3;r++)for(let i=0;i<ring.length;i++){const j=(i+1)%ring.length,base=positions.length/3;
        for(const [k,ri] of [[i,r],[j,r],[j,r+1],[i,r+1]]){const section=rings[ri!]!;positions.push(ring[k!]![0]!*section.scale,section.y,ring[k!]![1]!*section.scale);}
        const low=(rings[r]!.y+length/2)/length,high=(rings[r+1]!.y+length/2)/length;
        indices.push(base,base+2,base+1,base,base+3,base+2);uvs.push(.02,low,.70,low,.70,high,.02,high);}
      for(const end of [-1,1]){const base=positions.length/3;for(const [x,z] of ring){positions.push(x!*endScale,end*length/2,z!*endScale);uvs.push(.765+(x!/w+.5)*.22,.445+(z!/h+.5)*.109);}
        for(let i=1;i<ring.length-1;i++)indices.push(base,base+i+(end===1?1:0),base+i+(end===1?0:1));}
      // Babylon's default left-handed winding: all facets must face outwards.
      for(let i=0;i<indices.length;i+=3){const previous=indices[i+1]!;indices[i+1]=indices[i+2]!;indices[i+2]=previous;}
      const normals:number[]=[];VertexData.ComputeNormals(positions,indices,normals);d.positions=positions;d.indices=indices;d.normals=normals;d.uvs=uvs;return d;
}

/** Presentation kit. Coordinates are relative to the existing hall body/door. */
export class TimberThatch {
  readonly wood:StandardMaterial;
  readonly boards:StandardMaterial;
  readonly nails:StandardMaterial;
  readonly hay:StandardMaterial;
  readonly stone:StandardMaterial;
  constructor(readonly scene:Scene){
    this.wood=this.material('hall-oak','#ded5c8');
    this.boards=this.material('hall-roof-boards','#d7cbb9');
    this.nails=this.material('hall-roof-nails','#554b3d');
    this.hay=this.material('hall-hay-insulation','#ffffff');
    this.stone=this.material('hall-cut-stone','#fafbfc');
    const stoneTexture=new DynamicTexture('hall-limestone-grain',{width:128,height:128},this.scene,true);
    const stoneContext=stoneTexture.getContext();stoneContext.fillStyle='#f8fafb';stoneContext.fillRect(0,0,128,128);
    for(let i=0;i<500;i++){
      stoneContext.fillStyle=i%3?'rgba(133,143,153,.06)':'rgba(255,255,255,.25)';
      stoneContext.fillRect((i*43)%128,(i*71)%128,1+i%3,1+i%2);
    }
    stoneTexture.update(false);this.stone.diffuseTexture=stoneTexture;
    const hayTexture=new DynamicTexture('hall-hay-fibres',{width:128,height:128},this.scene,true);
    const hayContext=hayTexture.getContext();hayContext.fillStyle='#c5ad6e';hayContext.fillRect(0,0,128,128);
    for(let i=0;i<260;i++){
      const x=(i*47)%128,y=(i*79)%128;
      hayContext.strokeStyle=i%3?'rgba(247,222,152,.42)':'rgba(118,99,50,.25)';
      hayContext.beginPath();hayContext.moveTo(x,y);hayContext.lineTo(x+7+i%13,y-4+i%9);hayContext.stroke();
    }
    hayTexture.update(false);this.hay.diffuseTexture=hayTexture;
    this.wood.diffuseTexture=this.fibres('oak');
    const boardGrain=this.fibres('boards');boardGrain.wAng=Math.PI;this.boards.diffuseTexture=boardGrain;
  }
  private material(name:string,colour:string){const m=new StandardMaterial(name,this.scene);m.diffuseColor=Color3.FromHexString(colour);m.specularColor=Color3.Black();return m;}
  private fibres(name:string){
    const t=new DynamicTexture(`hall-${name}-grain`,{width:256,height:512},this.scene,true);
    const c=t.getContext() as CanvasRenderingContext2D;let seed=name==='oak'?53:171;
    const rnd=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
    c.fillStyle='#b4936c';c.fillRect(0,0,256,512);
    for(let i=0;i<230;i++){
      const x=rnd()*256;
      c.strokeStyle=rnd()>.5?'rgba(208,171,121,.22)':'rgba(87,61,34,.14)';
      c.lineWidth=.4+rnd()*1.2;c.beginPath();c.moveTo(x,0);c.bezierCurveTo(x+2,170,x-2,340,x,512);c.stroke();
    }
    for(let i=0;i<4;i++){const x=20+rnd()*216,y=30+rnd()*452;c.strokeStyle='rgba(87,61,34,.18)';
      for(let r=0;r<3;r++){c.beginPath();c.ellipse(x,y,2+r*2,7+r*6,0,0,Math.PI*2);c.stroke();}}
    // Reserve a small square in the oak atlas for the cut ends, independent of the side grain.
    if(name==='oak'){
      c.fillStyle='#b4936c';c.fillRect(192,224,64,64);
      c.strokeStyle='rgba(87,61,34,.20)';c.lineWidth=.8;
      for(let r=5;r<45;r+=4){c.beginPath();c.ellipse(224,256,r,r*.86,.15,0,Math.PI*2);c.stroke();}
      c.strokeStyle='rgba(87,61,34,.3)';c.beginPath();c.moveTo(224,256);c.lineTo(238,271);c.stroke();
    }
    t.update(false);return t;
  }
  build(parent:Mesh,plan?:BuildingPlan,roofOpening?:readonly [number,number]){
    const flatStone=plan?.recipe.roof.style==='flat-stone';
    const batches=new Map<StandardMaterial,Mesh[]>();
    const add=(m:Mesh,mat:StandardMaterial)=>{
      m.material=mat;
      if(mat===this.stone&&!m.isVerticesDataPresent('color'))m.setVerticesData('color',new Array(m.getTotalVertices()*4).fill(1));
      const a=batches.get(mat)??[];a.push(m);batches.set(mat,a);return m;
    };
    const beam=(name:string,a:Vector3,b:Vector3,w:number,h=w,material=this.wood)=>{
      const m=new Mesh(name,this.scene);
      timberBeamGeometry(Vector3.Distance(a,b),w,h,material===this.stone,plan?1:3).applyToMesh(m);
      m.position=Vector3.Center(a,b);m.rotationQuaternion=new Quaternion();Quaternion.FromUnitVectorsToRef(Vector3.Up(),b.subtract(a).normalize(),m.rotationQuaternion);return add(m,material);
    };
    const v=(x:number,y:number,z:number)=>new Vector3(x,y,z);
    const turnGrain=(piece:Mesh)=>{
      const uv=piece.getVerticesData('uv')!;
      for(let i=0;i<uv.length;i+=2){const u=uv[i]!;uv[i]=uv[i+1]!;uv[i+1]=1-u;}
      piece.setVerticesData('uv',uv);
    };
    // A thin interior deck, with staggered board ends, never extending under the walls.
    const floorWidth=plan?plan.width-2*plan.recipe.module.thickness:2.17;
    const floorDepth=plan?plan.depth-2*plan.recipe.module.thickness:1.95;
    const boardCount=Math.ceil(floorWidth/.14),floorBoardWidth=floorWidth/boardCount;
    for(let column=0;column<boardCount;column++){
      let z=-floorDepth/2;
      while(z<floorDepth/2-.001){const end=Math.min(floorDepth/2,z+(z===-floorDepth/2&&column%2?.35:.7));
        const board=MeshBuilder.CreateBox('factory-parquet',{width:floorBoardWidth-.002,height:.035,depth:end-z-.002},this.scene);
        turnGrain(board);
        board.position.set(-floorWidth/2+(column+.5)*floorBoardWidth,(plan?0:-.76)+.0175,(z+end)/2);add(board,this.wood);z=end;
      }
    }
    const worksHeight=plan?Math.ceil(Math.max(plan.sourceLevels*plan.recipe.courses*plan.recipe.module.height,plan.height*.65)/plan.recipe.module.height)*plan.recipe.module.height:0;
    const angle=(plan?.recipe.roof.slope??35)*Math.PI/180,half=plan?plan.width/2:1.225,eave=plan?(plan.phase==='works'?worksHeight:plan.height):.86,rise=half*Math.tan(angle),ridge=eave+rise;
    const roofHalfZ=plan?plan.depth/2+Math.max(plan.recipe.roof.overhang,plan.depth*(plan.recipe.roof.lengthExtraRatio??0)/2):1.32;
    // A raised central pavilion replaces this section of the lower roof.
    const roofRanges:readonly (readonly [number,number])[]=roofOpening?[[-roofHalfZ,roofOpening[0]],[roofOpening[1],roofHalfZ]]:[[-roofHalfZ,roofHalfZ]];
    const trussHalfZ=plan?plan.depth/2-.07:1.075;
    const trussIntervals=plan?Math.ceil(trussHalfZ*2/plan.recipe.roof.trussSpacing):2;
    const trussZ=Array.from({length:trussIntervals+1},(_,i)=>-trussHalfZ+i*trussHalfZ*2/trussIntervals).filter(z=>!roofOpening||z<=roofOpening[0]||z>=roofOpening[1]);
    if(roofOpening){trussZ.push(roofOpening[0],roofOpening[1]);trussZ.sort((a,b)=>a-b);}
    const frameHalf=.153/2,purlinSize=.07,chevronSize=.035,lathSize=.018,plankSize=.038;
    const roofNormalOffset=frameHalf+purlinSize+plankSize;
    const edge=half+(plan?(plan.recipe.roof.sideOverhang??plan.recipe.roof.overhang):.245)-(plan?roofNormalOffset*Math.sin(angle):0),len=edge/Math.cos(angle),rows=plan?Math.ceil(len/.42):4,step=len/rows;
    const structuralLen=plan?(half+.045)/Math.cos(angle):len,structuralRows=plan?Math.ceil(structuralLen/.42):rows;
    // Recessed secondary timbers share the purlin layer; boards rest directly on it.
    const purlinOffset=frameHalf+purlinSize/2,chevronOffset=frameHalf+purlinSize-chevronSize/2;
    const lathOffset=frameHalf+purlinSize-lathSize/2;
    const point=(side:number,distance:number,offset:number,z:number)=>v(side*(distance*Math.cos(angle)+offset*Math.sin(angle)),ridge-distance*Math.sin(angle)+offset*Math.cos(angle),z);
    if(!flatStone){
    // Three six-member king-post trusses, including the two gables.
    for(const z of trussZ){
      beam('hall-tie',v(-half,eave,z),v(half,eave,z),.123,.153);
      beam('hall-rafter-left',v(-half,eave,z),v(0,ridge,z),.123,.153);
      beam('hall-rafter-right',v(half,eave,z),v(0,ridge,z),.123,.153);
      beam('hall-king-post',v(0,eave,z),v(0,ridge,z),.123,.153);
      // Short braces perpendicular to each rafter form right triangles at the king post.
      for(const sign of [-1,1]){const x=Math.min(.26,rise/(Math.tan(angle)+1/Math.tan(angle))*.9),y=ridge-x*Math.tan(angle);
        beam('hall-strut',v(0,y-x/Math.tan(angle),z),v(sign*x,y,z),.075);}
      // Small wooden peg heads on the gable faces.
      for(const x of [-half+.1,0,half-.1]){
        const p=MeshBuilder.CreateCylinder('hall-peg',{diameter:.035,height:.018,tessellation:6},this.scene);
        p.rotation.x=Math.PI/2;p.position.set(x,eave,z+(z<0?-.085:.085));add(p,this.wood);
      }
    }
    // One continuous ridge purlin, visible through both open gables.
    const ridgePurlinY=ridge+(frameHalf+purlinSize)/Math.cos(angle)-.10;
    // Project beyond the ridge boards (z ±1.4), so the exposed end cannot be hidden by the roof.
    for(const [lo,hi] of roofRanges)beam('hall-ridge-purlin',v(0,ridgePurlinY,lo-(lo===-roofHalfZ?.02:0)),v(0,ridgePurlinY,hi+(hi===roofHalfZ?.02:0)),.11,.20);
    // Every layer is placed by contact along the roof normal, not arbitrary world-Y offsets.
    for(const side of [-1,1]){
      for(const distance of [half*.5/Math.cos(angle),half/Math.cos(angle)])for(const [lo,hi] of roofRanges){
        const m=MeshBuilder.CreateBox('hall-purlin',{width:purlinSize,height:purlinSize,depth:hi-lo-.1},this.scene);
        m.rotation.z=-side*angle;m.position=point(side,distance,purlinOffset,(lo+hi)/2);add(m,this.wood);
      }
      const chevrons=Math.ceil((roofHalfZ*2-.1)/.32);
      for(let i=0;i<=chevrons;i++){const z=-roofHalfZ+.05+i*(roofHalfZ*2-.1)/chevrons;
        if(roofOpening&&z>roofOpening[0]&&z<roofOpening[1])continue;
        beam('hall-chevron',point(side,0,chevronOffset,z),point(side,structuralLen,chevronOffset,z),chevronSize,.035);}
      for(let row=0;row<structuralRows;row++){

        for(const distance of [row*structuralLen/structuralRows+.06,Math.min(structuralLen-.03,(row+1)*structuralLen/structuralRows)])for(const [lo,hi] of roofRanges){
          const m=MeshBuilder.CreateBox('hall-lath',{width:.04,height:lathSize,depth:hi-lo},this.scene);
          m.rotation.z=-side*angle;m.position=point(side,distance,lathOffset,(lo+hi)/2);add(m,this.wood);
        }
      }
    }
    }
    // Flat ceiling atop the inhabited box; timbers run parallel to the ridge, not up the slopes.
    const liningCount=Math.ceil(half*2/.15),liningStep=half*2/liningCount;
    for(let i=0;i<liningCount;i++){
      const x=-half+(i+.5)*liningStep;
      if(!flatStone)for(const [lo,hi] of roofRanges)beam('hall-flat-ceiling-timber',v(x,eave-.025,Math.max(lo,-trussHalfZ)),v(x,eave-.025,Math.min(hi,trussHalfZ)),liningStep-.003,.05);
      if(plan)for(let level=1;level<plan.recipe.levels;level++){const y=level*(plan.recipe.courses*plan.recipe.module.height+plan.recipe.floorThickness);const odd=plan.recipe.rotateOddLevels&&level%2===1;beam('hall-floor',odd?v(-trussHalfZ,y,-x):v(x,y,-trussHalfZ),odd?v(trussHalfZ,y,-x):v(x,y,trussHalfZ),liningStep-.003,.05);}
    }
    // Hay rests on the horizontal deck between trusses; the sloping roof stays exposed.
    if(!flatStone)for(let bay=0;bay<trussZ.length-1;bay++){const z=(trussZ[bay]!+trussZ[bay+1]!)/2;
      if(roofOpening&&z>roofOpening[0]&&z<roofOpening[1])continue;
      const fill=MeshBuilder.CreateBox('hall-ceiling-hay-bay',{width:half*2-.25,height:.075,depth:trussZ[bay+1]!-trussZ[bay]!-.18},this.scene);
      fill.position.set(0,eave+.075/2,z);add(fill,this.hay);
    }
    if(flatStone&&plan&&plan.phase!=='works'){
      const module=plan.recipe.module,slabHeight=.08,rimWidth=module.length/2;
      // The slab stays inside the walls; the crown replaces the central opening.
      for(const [lo,hi] of roofRanges)beam('factory-stone-flat-roof',v(0,eave+slabHeight/2,lo),v(0,eave+slabHeight/2,hi),half*2,slabHeight,this.stone);
      // Joined annexes have no gable at the seam: no parapet across that join.
      const hasEnd=(sign:number)=>plan.stones.some(stone=>stone.axis==='x'&&stone.y>plan.height-module.height&&Math.abs(stone.z-sign*(plan.depth/2-module.thickness/2))<1e-8);
      const rim=(axis:'x'|'z',lo:number,hi:number,fixed:number,row:number)=>{
        const y=eave+slabHeight+(row+.5)*module.height;
        let start=lo;
        while(start<hi-1e-8){
          const end=Math.min(hi,start===lo&&row%2?lo+module.length/2:start+module.length);
          const at=(u:number)=>axis==='x'?v(u,y,fixed):v(fixed,y,u);
          const stone=beam('factory-stone-roof-parapet',at(start+module.joint/2),at(end-module.joint/2),module.height-module.joint,rimWidth-module.joint,this.stone);
          stone.rotationQuaternion=hallStoneCrossRotation(axis).multiply(stone.rotationQuaternion!);
          start=end;
        }
      };
      for(let row=0;row<1;row++){
        for(const [lo,hi] of roofRanges){
          const left=lo===-roofHalfZ&&hasEnd(-1),right=hi===roofHalfZ&&hasEnd(1);
          for(const sign of [-1,1]){
            // A removed lateral wall is a module join, not an exposed roof edge.
            const spans=plan.stones.filter(stone=>stone.axis==='z'&&stone.y>plan.height-module.height&&Math.abs(stone.x-sign*(half-module.thickness/2))<1e-8)
              .map(stone=>[stone.z-(stone.length+module.joint)/2,stone.z+(stone.length+module.joint)/2] as [number,number]).sort((a,b)=>a[0]-b[0]);
            const edges:Array<[number,number]>=[];
            for(const span of spans){const last=edges[edges.length-1];if(last&&span[0]<=last[1]+1e-8)last[1]=Math.max(last[1],span[1]);else edges.push([...span]);}
            for(const [a,b] of edges){
              const start=Math.max(a,lo+(left&&row%2===0?rimWidth:0)),end=Math.min(b,hi-(right&&row%2===0?rimWidth:0));
              if(end-start>module.joint)rim('z',start,end,sign*(half-rimWidth/2),row);
            }
          }
          const inset=row%2?rimWidth:0;
          if(left)rim('x',-half+inset,half-inset,-roofHalfZ+rimWidth/2,row);
          if(right)rim('x',-half+inset,half-inset,roofHalfZ-rimWidth/2,row);
        }
      }
    }
    // Both gables stay open: no daub hides the truss or the ridge purlin.
    // Low-poly cut-stone masonry with staggered vertical joints, without wooden wall framing.
    // Cut the actual wall geometry around each opening: no dark/glass decal hiding a solid body.
    if(plan){
      const works=plan.phase==='works',limit=works?worksHeight:plan.height;
      for(const stone of plan.stones){if(stone.y>limit)continue;
        const a=stone.axis==='x'?v(stone.x-stone.length/2,stone.y,stone.z):v(stone.x,stone.y,stone.z-stone.length/2);
        const b=stone.axis==='x'?v(stone.x+stone.length/2,stone.y,stone.z):v(stone.x,stone.y,stone.z+stone.length/2);
        const block=beam('factory-stone',a,b,stone.height,stone.thickness,this.stone);
        block.rotationQuaternion=hallStoneCrossRotation(stone.axis).multiply(block.rotationQuaternion!);
        const colours:number[]=[];for(let i=0;i<block.getTotalVertices();i++)colours.push(stone.shade,stone.shade,stone.shade,1);block.setVerticesData('color',colours);
      }
      for(const opening of plan.openings){
        if(opening.top>limit)continue;
        const dist=opening.face.endsWith('x')?plan.width/2:plan.depth/2;
        const at=(u:number,y:number,d=dist)=>{const p=facePoint(opening.face,u,y,d);return v(p.x,p.y,p.z);};
        if(opening.door&&!plan.recipe.entrance.open){
          const door=timberDoor(this.scene,this.wood,opening.right-opening.left,opening.top-opening.bottom-.02,timberBeamGeometry);
          door.position=at((opening.left+opening.right)/2,opening.bottom+.01,dist-.025);
          door.rotation.y=({'-x':-Math.PI/2,'+x':Math.PI/2,'-z':Math.PI,'+z':0})[opening.face];
          add(door,this.wood);
        }
        const wallThickness=plan.recipe.module.thickness,frameDepth=wallThickness+.02,frameWidth=.045;
        const frame=(name:string,u:number,y:number,width:number,height:number,depth:number,material=this.stone,d=dist-wallThickness/2)=>{
          const piece=material===this.stone?new Mesh(name,this.scene):MeshBuilder.CreateBox(name,{width,height,depth},this.scene);
          if(material===this.stone)timberBeamGeometry(height,width,depth,true,plan?1:3).applyToMesh(piece);
          piece.position=at(u,y,d);
          if(opening.face.endsWith('x'))piece.rotation.y=Math.PI/2;
          if(material===this.wood)turnGrain(piece);
          add(piece,material);
        };
        // Stone lintel occupies the reserved masonry course above the opening.
        frame('factory-window-lintel',(opening.left+opening.right)/2,opening.top+plan.recipe.module.height/2,opening.right-opening.left+2*wallThickness-.003,plan.recipe.module.height-.003,frameDepth);
        const bottom=opening.bottom+(opening.door?0:.035);
        for(const u of [opening.left+frameWidth/2,opening.right-frameWidth/2])frame('factory-window-jamb',u,(bottom+opening.top)/2,frameWidth,opening.top-bottom,frameDepth);
        if(!opening.door){
          frame('factory-window-sill',(opening.left+opening.right)/2,opening.bottom+.0175,opening.right-opening.left+.10,.035,wallThickness+.12,this.wood);
          for(const u of [opening.left+.0125,opening.right-.0125])frame('factory-window-wood-trim',u,(opening.bottom+.035+opening.top)/2,.065,opening.top-opening.bottom-.035,.025,this.wood,dist+.018);
          frame('factory-window-wood-trim',(opening.left+opening.right)/2,opening.top+.025,opening.right-opening.left+.10,.05,.025,this.wood,dist+.018);
        }
      }
      for(const wall of plan.murets){const length=Math.hypot(wall.b.x-wall.a.x,wall.b.z-wall.a.z),module=plan.recipe.module.length;
        for(let row=0;row<Math.round(wall.height/plan.recipe.module.height);row++){
          let start=0;while(start<length-.001){const end=Math.min(length,start===0&&row%2?module/2:start+module),y=(row+.5)*plan.recipe.module.height;
            const at=(u:number)=>v(wall.a.x+(wall.b.x-wall.a.x)*u/length,y,wall.a.z+(wall.b.z-wall.a.z)*u/length);
            // One explicit terminal cap per course, never stretch all regular stones.
            if(end-start>.006){const block=beam('factory-muret',at(start+.0015),at(end-.0015),plan.recipe.module.height-.003,wall.thickness-.003,this.stone);block.rotationQuaternion=hallStoneCrossRotation(Math.abs(wall.b.x-wall.a.x)>.001?'x':'z').multiply(block.rotationQuaternion!);}
            start=end;
          }
        }
      }
      if(works){for(const side of [-1,1]){const x=side*(half+.08);for(const z of [-trussHalfZ,trussHalfZ])beam('factory-scaffold-post',v(x,0,z),v(x,eave+.1,z),.05);
        for(let y=.5;y<eave;y+=.6)beam('factory-scaffold-rail',v(x,y,-trussHalfZ),v(x,y,trussHalfZ),.045);
      }}
    }else{
    type Opening={left:number;right:number;bottom:number;top:number};
    const window=(centre:number):Opening=>({left:centre-.20,right:centre+.20,bottom:-.06,top:.36});
    const wall=(axis:'x'|'z',sign:number,openings:Opening[])=>{
      const bottom=-.76,top=.86,rowHeight=.14,brickLength=.29;
      for(let row=0;bottom+row*rowHeight<top;row++){
        const low=bottom+row*rowHeight,high=Math.min(top,low+rowHeight),course=hallWallCourse(row,axis);
        const fixed=sign*course.fixed,width=course.limit*2,offset=row%2?brickLength/2:0;
        for(let column=-1;column<Math.ceil(width/brickLength)+1;column++){
          const left=Math.max(-course.limit,-course.limit+column*brickLength+offset),right=Math.min(course.limit,-course.limit+(column+1)*brickLength+offset);
          let fragments:Opening[]=right>left?[{left,right,bottom:low,top:high}]:[];
          for(const o of openings)fragments=fragments.flatMap(r=>{
            if(r.right<=o.left||r.left>=o.right||r.top<=o.bottom||r.bottom>=o.top)return [r];
            const l=Math.max(r.left,o.left),rr=Math.min(r.right,o.right);
            return [
              {left:r.left,right:l,bottom:r.bottom,top:r.top},
              {left:rr,right:r.right,bottom:r.bottom,top:r.top},
              {left:l,right:rr,bottom:r.bottom,top:Math.min(r.top,o.bottom)},
              {left:l,right:rr,bottom:Math.max(r.bottom,o.top),top:r.top},
            ].filter(p=>p.right-p.left>.01&&p.top-p.bottom>.005);
          });
          for(const r of fragments){if(r.right-r.left<.01)continue;
            const middle=(r.bottom+r.top)/2,position=(u:number)=>axis==='x'?v(u,middle,fixed):v(fixed,middle,u);
            const brick=beam('hall-cut-stone-block',position(r.left+.002),position(r.right-.002),r.top-r.bottom-.003,course.thickness,this.stone);
            brick.rotationQuaternion=hallStoneCrossRotation(axis).multiply(brick.rotationQuaternion!);
            const uv=brick.getVerticesData('uv')!;for(let i=0;i<uv.length;i+=2){uv[i]=(uv[i]!-.02)/.68;}brick.setVerticesData('uv',uv);
            const shade=.96+(((row*17+column*31)%5+5)%5)*.01;
            const colours:number[]=[];for(let i=0;i<brick.getTotalVertices();i++)colours.push(shade,shade,shade,1);
            brick.setVerticesData('color',colours);
          }
        }
      }
      const fixed=sign*hallWallCourse(0,axis).fixed;
      for(const o of openings){
        const at=(u:number,y:number)=>axis==='x'?v(u,y,fixed):v(fixed,y,u);
        const frame=(name:string,u:number,y:number,width:number,height:number,depth:number,material=this.stone,outside=false)=>{
          const piece=material===this.stone?new Mesh(name,this.scene):MeshBuilder.CreateBox(name,{width,height,depth},this.scene);
          if(material===this.stone)timberBeamGeometry(height,width,depth,true,3).applyToMesh(piece);
          piece.position=at(u,y);if(outside){if(axis==='x')piece.position.z+=sign*.098;else piece.position.x+=sign*.098;}
          if(axis==='z')piece.rotation.y=Math.PI/2;if(material===this.wood)turnGrain(piece);add(piece,material);
        };
        for(const u of [o.left+.0225,o.right-.0225])frame('hall-window-jamb',u,(o.bottom+o.top)/2,.045,o.top-o.bottom,.18);
        frame('hall-window-lintel',(o.left+o.right)/2,o.top+.025,o.right-o.left+.12,.05,.18);
        if(o.bottom>-.7){frame('hall-window-sill',(o.left+o.right)/2,o.bottom+.0175,o.right-o.left+.10,.035,.28,this.wood);
          for(const u of [o.left+.0125,o.right-.0125])frame('hall-window-wood-trim',u,(o.bottom+.035+o.top)/2,.065,o.top-o.bottom-.035,.025,this.wood,true);
          frame('hall-window-wood-trim',(o.left+o.right)/2,o.top+.025,o.right-o.left+.10,.05,.025,this.wood,true);
        }
      }
    };
    wall('x',-1,[window(-.72),window(.72),{left:-.275,right:.275,bottom:-.76,top:.08}]);
    wall('x',1,[window(-.72),window(.72)]);
    for(const sign of [-1,1])wall('z',sign,[window(0)]);
    const door=timberDoor(this.scene,this.wood,.55,.84,timberBeamGeometry);
    door.position.set(0,-.76,-1.10);door.rotation.y=Math.PI;add(door,this.wood);
    }
    // Individually nailed flush boards. Half-board offset on alternating courses.
    const span=roofHalfZ*2,boardWidth=.245;
    if(!flatStone&&(!plan||plan.phase!=='works')){
    for(const side of [-1,1]){
      const along=v(side*Math.cos(angle),-Math.sin(angle),0),normal=v(side*Math.sin(angle),Math.cos(angle),0);
      const origin=v(0,ridge,0);
      for(let row=0;row<rows;row++){
        const start=row*step,end=Math.min(len,start+step),length=end-start-.003;
        const offset=row%2?boardWidth/2:0;
        for(let column=-1;column<Math.ceil(span/boardWidth)+1;column++)for(const [rangeLo,rangeHi] of roofRanges){
          const lo=Math.max(rangeLo,-span/2+column*boardWidth+offset),hi=Math.min(rangeHi,-span/2+(column+1)*boardWidth+offset);
          if(hi-lo<.025)continue;
          const height=lathOffset+lathSize/2+plankSize/2;
          const board=MeshBuilder.CreateBox('hall-roof-plank',{width:length,height:plankSize,depth:hi-lo-.006},this.scene);
          board.rotation.z=-side*angle;board.position=origin.add(along.scale((start+end)/2)).add(normal.scale(height));board.position.z=(lo+hi)/2;add(board,this.boards);
          for(const z of [lo+.045,hi-.045]){
            if(hi-lo<.11&&z!==lo+.045)continue;
            const nail=MeshBuilder.CreateCylinder('hall-plank-nail',{diameter:.018,height:.007,tessellation:6},this.scene);
            nail.rotation.z=-side*angle;nail.position=origin.add(along.scale(start+.1)).add(normal.scale(height+.024));nail.position.z=z;add(nail,this.nails);
          }
        }
      }
      // Two narrow ridge boards cover the seam instead of a thick rounded cap.
      for(const [lo,hi] of roofRanges){
      const cap=MeshBuilder.CreateBox('hall-board-ridge',{width:.42,height:.035,depth:hi-lo+(roofOpening?0:.01)},this.scene);
      const capApex=v(0,ridge+(lathOffset+lathSize/2+plankSize)/Math.cos(angle)+.025,0);
      cap.rotation.z=-side*angle;cap.position=capApex.add(along.scale(.17));cap.position.z=(lo+hi)/2;add(cap,this.boards);
      }
    }
    }
    if(plan?.phase==='works'){
      // Exposed frame only: remove completed roof layers and hay from the construction view.
      for(const [mat,parts] of batches)batches.set(mat,parts.filter(m=>{const remove=/hall-(purlin|chevron|lath|ceiling-hay|flat-ceiling)/.test(m.name);if(remove)m.dispose();return !remove;}));
    }
    for(const [mat,parts] of batches){const merged=Mesh.MergeMeshes(parts,true,true);if(!parts.length)continue;if(!merged)throw new Error('Building geometry merge failed');merged.name=`${parent.name}-${mat.name}`;merged.parent=parent;merged.material=mat;merged.receiveShadows=true;}
    return parent;
  }
}
