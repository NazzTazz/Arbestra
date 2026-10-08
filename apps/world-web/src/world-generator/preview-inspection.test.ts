import {expect,it} from 'vitest';
import type {GeneratedLandscape} from '@arbestra/contracts';
import {candidateIdentity,flatPreviewPoint,forestHabitatLabel,renderIdentity} from './preview-inspection';
it('unrolls the complete domain as a rectangle and preserves physical heights',()=>{
 expect(flatPreviewPoint(256,128,.25,0,0,16)).toEqual([-128,4,-64]);
 expect(flatPreviewPoint(256,128,.25,256,128,-16)).toEqual([128,-4,64]);
 expect(flatPreviewPoint(256,128,.25,128,64,16,4)).toEqual([0,16,0]);
});
it('never reuses render identity across candidates, revisions, views or diagnostic settings',()=>{
 const a=candidateIdentity({id:'a',revision:1,checksum:'abc'});
 expect(a).not.toBe(candidateIdentity({id:'b',revision:1,checksum:'abc'}));
 expect(a).not.toBe(candidateIdentity({id:'a',revision:2,checksum:'def'}));
 const settings={candidate:a,view:'map' as const,layer:'terrain',x:0,y:0,fog:false,solar:false,exaggeration:1,grid:false,wireframe:false};
 const key=renderIdentity(settings);
 expect(renderIdentity({...settings,x:42})).toBe(key);
 for(const change of [{view:'local' as const},{layer:'water'},{exaggeration:4},{grid:true},{candidate:'b'}])expect(renderIdentity({...settings,...change})).not.toBe(key);
 expect(renderIdentity({...settings,view:'local',x:0})).not.toBe(renderIdentity({...settings,view:'local',x:32}));
});
it('shows no forest habitat percentage on all-water artefacts, including floating-point residual land',()=>{
 const data={terrainCodes:[2,2],metrics:{waterPercent:100,treePercent:50}} as GeneratedLandscape;
 expect(forestHabitatLabel(data)).toContain('Non applicable');
 expect(forestHabitatLabel({...data,terrainCodes:[0,2],metrics:{...data.metrics,waterPercent:99.999999999}})).toContain('Non applicable');
 expect(forestHabitatLabel({...data,terrainCodes:[0,2],metrics:{...data.metrics,waterPercent:50,treePercent:30}})).toContain('30.00%');
});
