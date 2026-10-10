import {transformFootprint,type SpatialDimensions} from './building-footprint.js';
import {RC1_WORLD} from './rc1-runtime.js';
import { Type, type Static } from '@sinclair/typebox';
import { BuildingVisualLayoutSchema } from './villages.js';
import { SpawnPointSchema, spawnDelta, type SpawnSurface } from './spawn-map.js';

export const StarterElementSchema = Type.Object({
  key: Type.String({minLength:1,maxLength:32}), type: Type.String(), level: Type.Integer({minimum:1}),
  quarterTurns: Type.Integer({minimum:0,maximum:3}), visualLayout: Type.Union([BuildingVisualLayoutSchema,Type.Null()]),
  cells: Type.Array(Type.Object({x:Type.Integer(),y:Type.Integer(),role:Type.Union([Type.Literal('anchor'),Type.Literal('extension'),Type.Literal('body')])}),{minItems:1,maxItems:32}),
});
export type StarterElement = Static<typeof StarterElementSchema>;
export const StarterKitSchema=Type.Object({version:Type.String(),elements:Type.Array(StarterElementSchema,{minItems:1,maxItems:32})});
export type StarterKit=Static<typeof StarterKitSchema>;
export const SpawnPoseRequestSchema=Type.Object({
  commandId:Type.String({format:'uuid'}),artifactChecksum:Type.String({pattern:'^[a-f0-9]{64}$'}),kitVersion:Type.String(),
  point:SpawnPointSchema,quarterTurns:Type.Integer({minimum:0,maximum:3}),mode:Type.Union([Type.Literal('grouped'),Type.Literal('manual')]),
  playerName:Type.String({minLength:1,maxLength:40}),villageName:Type.String({minLength:1,maxLength:60}),
},{additionalProperties:false});
export type SpawnPoseRequest=Static<typeof SpawnPoseRequestSchema>;
export const StarterPoseRequestSchema=Type.Object({commandId:Type.String({format:'uuid'}),elementKey:Type.String({minLength:1,maxLength:32}),point:SpawnPointSchema,quarterTurns:Type.Integer({minimum:0,maximum:3})},{additionalProperties:false});
export type StarterPoseRequest=Static<typeof StarterPoseRequestSchema>;
export const StarterInstallationSchema=Type.Object({villageId:Type.String({format:'uuid'}),kit:StarterKitSchema,remaining:Type.Array(Type.String()),anchor:SpawnPointSchema,quarterTurns:Type.Integer(),referenceHeight:Type.Number()});
export type StarterInstallation=Static<typeof StarterInstallationSchema>;
export interface SpawnTerrace {cellX:number;cellY:number;height:number}
export const SpawnTerraceSchema=Type.Object({cellX:Type.Integer(),cellY:Type.Integer(),height:Type.Number()});
/** Rotate each building's occupied cells and visual recipe together. Canonical torus coordinates. */
export function poseStarterElement(element:StarterElement,point:{x:number;y:number},turns:number,relativeToHall=true,world:SpatialDimensions=RC1_WORLD){
  const anchor=relativeToHall?{x:0,y:0}:element.cells.find(c=>c.role==='anchor')!;
  const cells=transformFootprint(element.cells.map(c=>({...c,x:c.x-anchor.x,y:c.y-anchor.y})),point,turns,world).map(({cellX,cellY,role})=>({cellX,cellY,role}));
  const quarterTurns=(element.quarterTurns+turns)%4;
  return {...element,quarterTurns,visualLayout:element.visualLayout?{...element.visualLayout,quarterTurns}:null,cells};
}
export function starterElementSurfaces(element:StarterElement,relativeToHall=true):SpawnSurface[]{
  const anchor=relativeToHall?{x:0,y:0}:element.cells.find(c=>c.role==='anchor')!;
  return element.cells.map(c=>({x:c.x-anchor.x,y:c.y-anchor.y,halfWidth:.5,halfHeight:.5}));
}
/** Local edits stay inside the closed footprint; the signed substrate is never replaced. */
export function terraceHeight(edits:readonly SpawnTerrace[],x:number,y:number,world:SpatialDimensions=RC1_WORLD):number|undefined{
  return edits.find(e=>Math.abs(spawnDelta(x,e.cellX,world.widthCells))<=.5+1e-8&&Math.abs(spawnDelta(y,e.cellY,world.heightCells))<=.5+1e-8)?.height;
}
