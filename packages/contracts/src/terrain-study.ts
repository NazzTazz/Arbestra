import {studyPlateauHeight,type StudyPlateaus} from './terrain-study-plateaus.js';
import {carveStudyBasins,studyBasinClearance,type StudyBasins} from './terrain-study-basins.js';
import {periodicClimateNoise,wrapClimate} from './world-climate.js';
import type {WorldGeography} from './world-geography.js';
export interface TerrainStudy {
 id:'t1';base:number;waterLevel?:number;layoutScale?:number;basins?:StudyBasins;plateaus?:StudyPlateaus;
 ramp?:{start:[number,number,number];end:[number,number,number];halfWidth:number;shoulder:number};
 chains:{name:string;points:[number,number,number,number][];highPlateau?:{ceiling:number;flank:number} }[];
 hollows:{name:string;x:number;y:number;rx:number;ry:number;depth:number;folds?:{angle:number;spacing:number;bend:number}}[];
}
export function createTerrainStudy():WorldGeography {
 // Feed the existing three G1/G2 folds separately, preserving the strips between them.
 const arms=([-1,0,1] as const).map(lane=>{
  const path:[number,number][]=[[-58,168]];
  for(let u=-9;u<=9;u+=3){const v=lane*4.5+1.2*Math.sin(u*.22)+lane*.35*Math.sin(u*.41);path.push([213+u*Math.cos(-.55)-v*Math.sin(-.55)-256,31+u*Math.sin(-.55)+v*Math.cos(-.55)+128]);}
  path.push([-28,148]);return {path,radius:1.1};
 });
 return {version:1,seed:4109,width:256,height:128,spacing:4,cutoff:0,scale:1,positiveScale:1,negativeScale:1,floor:0,
 filled:Array<number>(2048).fill(0),lakeDepth:Array<number>(2048).fill(0),parent:Array<number>(2048).fill(-1),accumulation:Array<number>(2048).fill(0),rivers:[],lakes:[],geology:{version:1},
 parameters:{waterPercent:0,amplitude:16,meanElevation:1,channelWidth:4,treePercent:32,solarInfluence:100},
 study:{id:'t1',base:.25,ramp:{start:[174,112,.25],end:[174,87,3],halfWidth:5,shoulder:4},basins:{
  bowls:[{x:0,y:80,rx:20,ry:14,floor:-.75},{x:16,y:16,rx:43,ry:14,floor:-.75}],
  // Unwrapped coordinates preserve the intended passage E4 -> F1 through Y=128.
  path:[[0,80],[-17,83],[-34,75],[-47,82],[-62,70],[-80,66],[-94,72],[-110,82],[-116,95],[-111,110],[-100,121],[-88,132],[-75,138],[-65,149],[-58,168]],
  radius:3.8,floor:-1,outerBendWidening:.6,channels:[...arms,{path:[[-28,148],[-17,144],[0,143],[16,144]],radius:3.8}]
 },chains:[
  {name:'Chaîne A',points:[[48,39,0,6],[59,43,1.7,8],[70,45,3.1,9],[81,50,2.5,8],[92,57,1.3,7],[101,59,0,5]]},
  {name:'Chaîne B',highPlateau:{ceiling:3,flank:.45},points:[[145,94,0,6],[154,89,4.6,10],[162,85,4.8,11],[171,81,4.5,10],[181,86,3.8,10],[190,92,2.8,9],[202,99,0,6]]}
 ],hollows:[{name:'Creux C',x:120,y:80,rx:18,ry:2.6,depth:1.75,folds:{angle:.3,spacing:5,bend:1.5}},{name:'Creux D',x:213,y:31,rx:15,ry:2.3,depth:1.75,folds:{angle:-.55,spacing:4.5,bend:1.2}}]}};
}
const layouts=new WeakMap<WorldGeography,WorldGeography>();
const delta=(a:number,b:number,size:number)=>wrapClimate(a-b+size/2,size)-size/2;
/** Local compact forms on an otherwise exactly flat dry torus. Heights in cell widths. */
export function terrainStudyElevation(g:WorldGeography,x:number,y:number):number {
 if(g.study?.layoutScale&&g.study.layoutScale!==1){
  const scale=g.study.layoutScale;let layout=layouts.get(g);
  if(!layout){layout={...g,width:g.width/scale,height:g.height/scale,study:{...g.study,layoutScale:1}};layouts.set(g,layout);}
  return terrainStudyElevation(layout,x/scale,y/scale);
 }
 const s=g.study!;x=wrapClimate(x,g.width);y=wrapClimate(y,g.height);let ridge=0,clearance=Infinity;
 for(const chain of s.chains)for(let i=1;i<chain.points.length;i++){
  const a=chain.points[i-1]!,b=chain.points[i]!,dx=delta(b[0],a[0],g.width),dy=delta(b[1],a[1],g.height);
  const px=delta(x,a[0],g.width),py=delta(y,a[1],g.height),t=Math.max(0,Math.min(1,(px*dx+py*dy)/(dx*dx+dy*dy)));
  const distance=Math.hypot(px-dx*t,py-dy*t),radius=a[3]+(b[3]-a[3])*t;
  if(s.plateaus)clearance=Math.min(clearance,distance-radius);
  const tEdge=Math.max(0,Math.min(1,(1-distance/radius)/(chain.highPlateau?.flank??1)));
  const profile=chain.highPlateau?tEdge*tEdge*(3-2*tEdge):Math.pow(Math.max(0,1-(distance/radius)**2),1.6);
  const facets=.8+.2*periodicClimateNoise(x/g.width,y/g.height,49,g.seed+127);
  const height=(a[2]+(b[2]-a[2])*t)*profile*facets;
  ridge=Math.max(ridge,chain.highPlateau?Math.min(chain.highPlateau.ceiling-s.base,height):height);
 }
 let hollow=0;
 for(const p of s.hollows){
  const dx=delta(x,p.x,g.width),dy=delta(y,p.y,g.height);
  if(s.plateaus)clearance=Math.min(clearance,Math.hypot(dx,dy)-Math.hypot(p.rx,p.ry+(p.folds?.spacing??0)));
  if(!p.folds){const r=(dx/p.rx)**2+(dy/p.ry)**2;hollow+=p.depth*Math.pow(Math.max(0,1-r),2);continue;}
  const {angle,spacing,bend}=p.folds,c=Math.cos(angle),sn=Math.sin(angle),u=dx*c+dy*sn,v=-dx*sn+dy*c;
  // Three narrow, curving furrows. Use their envelope, never sum depths at overlaps.
  // Compact ends meet the untouched plain smoothly; the main centre reaches -6 units.
  let folded=0;
  for(let lane=-1;lane<=1;lane++){
   const length=p.rx*(lane===0?1:.8),width=p.ry*(lane===0?1:.8);
   const centre=lane*spacing+bend*Math.sin(u*.22)+lane*.35*Math.sin(u*.41);
   const r=(u/length)**2+((v-centre)/width)**2;
   folded=Math.max(folded,p.depth*(lane===0?1:lane<0?.68:.8)*Math.pow(Math.max(0,1-r),2));
  }
  hollow+=folded;
 }
 let elevation=s.base+ridge-hollow;
 if(s.plateaus){
  clearance=Math.min(clearance,studyBasinClearance(g,x,y));
  if(s.ramp){const a=s.ramp.start,b=s.ramp.end,dx=delta(b[0],a[0],g.width),dy=delta(b[1],a[1],g.height),px=delta(x,a[0],g.width),py=delta(y,a[1],g.height),t=Math.max(0,Math.min(1,(px*dx+py*dy)/(dx*dx+dy*dy)));clearance=Math.min(clearance,Math.hypot(px-dx*t,py-dy*t)-s.ramp.halfWidth-s.ramp.shoulder);}
  const t=Math.max(0,Math.min(1,clearance/4)),weight=t*t*(3-2*t);
  if(weight>0)elevation+=(studyPlateauHeight(g,x,y)-s.base)*weight;
 }
 if(s.ramp){
  const {start:a,end:b,halfWidth,shoulder}=s.ramp,dx=delta(b[0],a[0],g.width),dy=delta(b[1],a[1],g.height);
  const px=delta(x,a[0],g.width),py=delta(y,a[1],g.height),t=Math.max(0,Math.min(1,(px*dx+py*dy)/(dx*dx+dy*dy)));
  const distance=Math.hypot(px-t*dx,py-t*dy),edge=Math.max(0,Math.min(1,(distance-halfWidth)/shoulder));
  const blend=1-edge*edge*(3-2*edge),profile=t*t*(3-2*t);
  elevation+=((a[2]+(b[2]-a[2])*profile)-elevation)*blend;
 }
 return carveStudyBasins(g,elevation,x,y);
}

export function createTerrainStudyVariation():WorldGeography{
 const g=createTerrainStudy();g.study!.plateaus={spacing:16,min:.125,max:.75,blend:2.5,warp:3};
 g.study!.basins!.bowls=[{x:32,y:64,rx:68,ry:35,floor:-.75,inner:.6,shore:.12},{x:14,y:33,rx:30,ry:27,floor:-.75,inner:.5,shore:.1},{x:16,y:16,rx:43,ry:14,floor:-.75}];
 return g;
}
