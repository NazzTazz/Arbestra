import type {GeneratedLandscape,WorldCandidate} from '@arbestra/contracts';
export type PreviewView='torus'|'map'|'local';
export function candidateIdentity(c:Pick<WorldCandidate,'id'|'revision'|'checksum'>){return `${c.id}:${c.revision}:${c.checksum??''}`;}
export function flatPreviewPoint(width:number,height:number,altitudeRatio:number,x:number,y:number,z:number,exaggeration=1){
 return [x-width/2,z*altitudeRatio*exaggeration,y-height/2];
}
export function forestHabitatLabel(data:GeneratedLandscape){
 // Interpret existing artefacts without rewriting their checksum or their historic metrics.
 if(data.metrics.waterPercent>=100-1e-6||!data.terrainCodes.some(code=>code!==2))return 'Non applicable : aucune terre';
 return `${data.metrics.treePercent.toFixed(2)}% des terres (habitat, pas canopée)`;
}
export function renderIdentity(input:{candidate:string;view:PreviewView;layer:string;x:number;y:number;fog:boolean;solar:boolean;exaggeration:number;grid:boolean;wireframe:boolean}){
 return JSON.stringify({...input,x:input.view==='local'?input.x:0,y:input.view==='local'?input.y:0});
}
