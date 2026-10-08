import { Type, type Static } from '@sinclair/typebox';

export const GeneratorParametersSchema = Type.Object({
  waterPercent: Type.Number({minimum:0, maximum:100}),
  // r8: symmetric height/depth bound; r0-r7: historical total range. Recipe versions disambiguate persisted values.
  amplitude: Type.Number({minimum:0, maximum:16}),
  meanElevation: Type.Number({minimum:-8, maximum:8}),
  channelWidth: Type.Integer({minimum:1, maximum:32}),
  treePercent: Type.Number({minimum:0, maximum:100}),
  solarInfluence: Type.Number({minimum:0, maximum:100}),
}, {additionalProperties:false});
export type GeneratorParameters = Static<typeof GeneratorParametersSchema>;
export const DEFAULT_GENERATOR_PARAMETERS: GeneratorParameters = {
  waterPercent:25, amplitude:8, meanElevation:1, channelWidth:4, treePercent:30, solarInfluence:50,
};
export const GenerateCandidateSchema = Type.Object({
  commandId:Type.String({format:'uuid'}), name:Type.String({minLength:1,maxLength:80}),
  seed:Type.Integer({minimum:0,maximum:2147483647}),
  width:Type.Integer({minimum:64,maximum:512,multipleOf:32}),
  height:Type.Integer({minimum:64,maximum:512,multipleOf:32}),
  version:Type.Union([Type.Literal(2),Type.Literal(3)]), parameters:GeneratorParametersSchema,
}, {additionalProperties:false});
export type GenerateCandidate = Static<typeof GenerateCandidateSchema>;
export const CandidateIdentitySchema = Type.Object({
  checksum:Type.String({pattern:'^[a-f0-9]{64}$'}), revision:Type.Integer({minimum:1}),
}, {additionalProperties:false});
/** x/y: footprint origin. direction: X or Y. from/to follow the positive axis, not low/high order. */
export interface NaturalStair {
  x:number; y:number; direction:0|1; length:2; width:1|2|3|4|5; low:number; high:number;
  from:number; to:number;
}
export interface GeneratedLandscape {
  version:2|3; recipeRevision?:number; climateRevision?:number; provenance?:{version:1;worldRecipeChecksum:string}; width:number; height:number; seed:number; altitudeCellRatio:number;
  elevations:number[]; terrainCodes:number[]; woodland:number[];
  exposure:number[]; humidity:number[]; walkable:number[]; components:number[];
  geography?:import('./world-geography.js').WorldGeography;
  forest?:import('./world-forest.js').WorldForest;
  stoneSites?:import('./world-stone.js').WorldStoneSite[];
  stairs:NaturalStair[]; hydrology?:import('./world-hydrology.js').Hydrology;
  metrics:{quality?:import('./world-landscape-quality.js').LandscapeQuality;landsWithoutAccess?:number;waterPercent:number; meanElevation:number; minElevation:number; maxElevation:number;
    amplitude:number; treePercent:number; landComponents:number; accessibleComponents:number;
    isolatedZones:number; stairCount:number; warnings:string[]};
}
export interface WorldCandidate {
  id:string; name:string; recipeRevision?:number; seed:number; width:number; height:number; version:2|3;
  parameters:GeneratorParameters; status:'pending'|'running'|'ready'|'failed';
  attempt:number; revision:number; checksum:string|null; error:string|null;
  retained:boolean; opened:boolean; createdAt:string; heartbeatAt:string|null;
  durationMs:number|null; metrics:GeneratedLandscape['metrics']|null;
}
/** Same height or an explicit stair; lateral cliff entrances are never inferred. */
export function canTraverseLandscape(data:GeneratedLandscape, from:number, to:number):boolean {
  if(!data.walkable[from] || !data.walkable[to]) return false;
  const x=from%data.width, y=Math.floor(from/data.width);
  const adjacent=[y*data.width+(x+1)%data.width,y*data.width+(x+data.width-1)%data.width,
    ((y+1)%data.height)*data.width+x,((y+data.height-1)%data.height)*data.width+x];
  if(!adjacent.includes(to)) return false;
  let acrossStair=false;
  for(const s of data.stairs){
    const a=stairContains(s,from,data.width,data.height),b=stairContains(s,to,data.width,data.height);
    const lateral=s.direction===0?Math.floor(from/data.width)!==Math.floor(to/data.width):from%data.width!==to%data.width;
    if(lateral&&a!==b)return false;
    if(a&&b)acrossStair=true;
  }
  return data.elevations[from]===data.elevations[to] || acrossStair;
}

/** Canonical pairs across the two-cell footprint, one for each lateral lane. */
export function naturalStairPairs(s:NaturalStair,width:number,height:number):Array<[number,number]> {
  const index=(x:number,y:number)=>((y%height+height)%height)*width+(x%width+width)%width;
  return Array.from({length:s.width},(_,lane)=>{
    const x=s.x+(s.direction===1?lane:0),y=s.y+(s.direction===0?lane:0);
    return [index(x,y),index(x+(s.direction===0?1:0),y+(s.direction===1?1:0))];
  });
}
export function createLandscapeStairAccess(data:Pick<GeneratedLandscape,'stairs'|'width'|'height'>){
  const cells=new Map<number,NaturalStair>(),edges=new Set<string>();
  for(const s of data.stairs)for(const [a,b]of naturalStairPairs(s,data.width,data.height)){
    cells.set(a,s);cells.set(b,s);edges.add(Math.min(a,b)+':'+Math.max(a,b));
  }
  return {cells,edges};
}
export function isLandscapeStairSide(cells:Map<number,NaturalStair>,a:number,b:number,width:number):boolean {
  const sa=cells.get(a),sb=cells.get(b);
  const lateral=(s:NaturalStair)=>s.direction===0?Math.floor(a/width)!==Math.floor(b/width):a%width!==b%width;
  return Boolean(sa&&lateral(sa)&&sa!==sb||sb&&lateral(sb)&&sb!==sa);
}
function stairContains(s:NaturalStair,cell:number,width:number,height:number):boolean {
  const x=((cell%width-s.x)%width+width)%width,y=((Math.floor(cell/width)-s.y)%height+height)%height;
  return s.direction===0?x<s.length&&y<s.width:x<s.width&&y<s.length;
}
