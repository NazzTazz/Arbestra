/* global process, console, performance */
// Read-only review probe. node --import tsx scripts/audit-world-generator.mjs [artifact.json]
// Plateau = connected land cells at equal height, ignoring vegetation. No database access.
import {generateLandscape,landscapeNeighbors,landscapeMetrics} from '../packages/contracts/src/world-landscape.ts';
import {DEFAULT_GENERATOR_PARAMETERS as defaults} from '../packages/contracts/src/world-generator.ts';
import {readFile} from 'node:fs/promises';
function inspect(d){
 const {width:w,height:h}=d,n=w*h;let changes=0,offGrid=0,landCliffs=0,landChanges=0;const seen=new Uint8Array(n),areas=[];
 for(let i=0;i<n;i++){
  const x=i%w,y=Math.floor(i/w),z=d.elevations[i];
  for(const [j,boundary]of [[y*w+(x+1)%w,(x+1)%8],[((y+1)%h)*w+x,(y+1)%8]])if(z!==d.elevations[j]){
   changes++;if(boundary)offGrid++;if(d.terrainCodes[i]===1&&d.terrainCodes[j]===1){landChanges++;if(Math.abs(z-d.elevations[j])>1)landCliffs++;}
  }
  if(seen[i]||d.terrainCodes[i]!==1)continue;
  const q=[i];seen[i]=1;
  for(let k=0;k<q.length;k++)for(const j of landscapeNeighbors(q[k],w,h))if(!seen[j]&&d.terrainCodes[j]===1&&d.elevations[j]===z){seen[j]=1;q.push(j);}
  areas.push(q.length);
 }
 areas.sort((a,b)=>a-b);
 return {plateaus:areas.length,plateauMedianCells:areas[Math.floor(areas.length/2)],plateauMaxCells:areas.at(-1),heightEdges:changes,offGridHeightEdges:offGrid,landHeightEdges:landChanges,landCliffsOverOne:landCliffs,metrics:d.metrics};
}
const out=[];
for(const [seed,w,h,overrides]of [[42,64,64,{}],[42,256,128,{}],[42,512,256,{}],[2,512,256,{waterPercent:11,treePercent:15,solarInfluence:100}],[17,128,64,{amplitude:16,treePercent:80}]]){
 const parameters={...defaults,...overrides},start=performance.now(),d=generateLandscape(seed,w,h,parameters);
 out.push({seed,w,h,parameters,durationMs:performance.now()-start,...inspect(d)});
}
const d={version:3,width:64,height:64,seed:0,altitudeCellRatio:.25,elevations:[],terrainCodes:[],woodland:[],walkable:[],components:new Array(4096).fill(-1),exposure:new Array(4096).fill(0),humidity:new Array(4096).fill(0),stairs:[]};
for(let y=0;y<64;y++)for(let x=0;x<64;x++){
 const land=x<16||(x>=32&&x<48);d.elevations.push(land?x>=8&&x<16?2:1:-1);d.terrainCodes.push(land?1:2);d.woodland.push(x>=32&&x<48?1:0);d.walkable.push(x<16?1:0);
}
const counterexample=landscapeMetrics(d);
const stored=process.argv[2]?inspect(JSON.parse(await readFile(process.argv[2],'utf8'))):undefined;
console.log(JSON.stringify({out,counterexample,stored},null,2));
