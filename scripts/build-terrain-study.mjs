import process from 'node:process';
import {createHash} from 'node:crypto';
// Rebuild the fixed T1 art-direction artefact. No database or gameplay writes.
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createTerrainStudyVariation} from '../packages/contracts/src/terrain-study.ts';
import {sampleWorldGeography} from '../packages/contracts/src/world-geography.ts';
import {buildExposureField,exposureAt,climateAt} from '../packages/contracts/src/world-climate.ts';
import {generateChunkStoneCoverage} from '../packages/contracts/src/terrain-study-chunk-stone.ts';
import {generateStudyStoneCoverage} from '../packages/contracts/src/terrain-study-stone.ts';
import {forestDistanceSquared} from '../packages/contracts/src/world-forest.ts';
import {generateWorldForest} from '../packages/contracts/src/world-forest.ts';
const large=process.argv.includes('--alpha512'),id=large?'t1-alpha512':'t1';
const g=large?JSON.parse(await readFile('apps/world-web/public/studies/t1-alpha.json','utf8')).geography:createTerrainStudyVariation();
if(large){g.width=512;g.height=256;g.study.layoutScale=2;for(const key of ['filled','lakeDepth','accumulation','parent'])g[key]=Array(g.width*g.height/16).fill(key==='parent'?-1:0);}
const n=g.width*g.height,field=buildExposureField();
const d={version:3,width:g.width,height:g.height,seed:g.seed,altitudeCellRatio:.25,geography:g,
 elevations:[],terrainCodes:Array(n).fill(0),woodland:[],exposure:[],humidity:[],walkable:Array(n).fill(0),components:Array(n).fill(-1),stairs:[],
 metrics:{waterPercent:0,meanElevation:0,minElevation:Infinity,maxElevation:-Infinity,amplitude:0,treePercent:0,landComponents:0,accessibleComponents:0,isolatedZones:0,stairCount:0,warnings:[]}};
const forestTerrain=[];let sum=0,area=0;
for(let y=0;y<g.height;y++)for(let x=0;x<g.width;x++){
 const s=sampleWorldGeography(g,x+.5,y+.5),z=s.elevation*4,weight=2.4+Math.cos((y+.5)/g.height*Math.PI*2+Math.PI);
 forestTerrain.push(z<=0?2:0);d.elevations.push(Math.round(z));d.exposure.push(exposureAt(field,(x+.5)/g.width,(y+.5)/g.height));d.humidity.push(climateAt(x/g.width,y/g.height,g.seed).humidity);
 sum+=z*weight;area+=weight;d.metrics.minElevation=Math.min(d.metrics.minElevation,z);d.metrics.maxElevation=Math.max(d.metrics.maxElevation,z);
}
const stone=large?generateChunkStoneCoverage(g):generateStudyStoneCoverage(g);d.stoneSites=stone.sites;
if(stone.report.uncovered)throw Error('Incomplete stone distance coverage: '+JSON.stringify(stone.report));
const forest=generateWorldForest(g,field,(x,y)=>sampleWorldGeography(g,x,y),forestTerrain);
d.forest=forest.forest;d.forest.trees=d.forest.trees.filter(t=>sampleWorldGeography(g,t.x,t.y).elevation>0&&sampleWorldGeography(g,t.x,t.y).rock<.45&&!d.stoneSites.some(site=>site.rocks.some(r=>forestDistanceSquared(t.x,t.y,r.x,r.y,g.width,g.height)<Math.pow(Math.max(r.width,r.depth)*.8,2))));d.woodland=forest.woodland;
Object.assign(d.metrics,{meanElevation:sum/area,amplitude:d.metrics.maxElevation-d.metrics.minElevation,treePercent:d.forest.coverage});
await mkdir('apps/world-web/public/studies',{recursive:true});await writeFile('apps/world-web/public/studies/'+id+'.json',JSON.stringify(d));
await writeFile('apps/world-web/public/studies/'+id+'-coverage.json',JSON.stringify(stone.report,null,2)+'\n');
if(large)await writeFile('apps/world-web/public/studies/'+id+'-manifest.json',JSON.stringify({id,source:'t1-alpha.json',width:512,height:256,chunkSize:32,layoutScale:2,previewWaterLevel:0,sha256:createHash('sha256').update(JSON.stringify(d)).digest('hex'),status:'Variante agrandie a comparer a la reference alpha validee'},null,2)+'\n');
process.stdout.write(JSON.stringify({world:id,trees:d.forest.trees.length,metrics:d.metrics,stone:stone.report})+'\n');
