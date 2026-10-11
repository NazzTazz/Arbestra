import {readFileSync} from 'node:fs';
import {expect,it,vi} from 'vitest';
import {applyVillageFrame,type VillageState} from '@arbestra/contracts';
import {VillageSyncProjections} from './sync-projections.js';
const fixture=()=>JSON.parse(readFileSync(new URL('../../../../../tests/fixtures/village-sync-state.json',import.meta.url),'utf8')) as VillageState;
const commit=(state:VillageState)=>({worldId:state.world.id,villageId:state.village.id,through:new Date(state.serverTime)});
const base=(state:VillageState)=>({revision:state.syncRevision!,serverTime:state.serverTime});
it('returns the shared frame and never reuses another owner or time projection as its base',async()=>{
 const before=fixture(),after={...before,syncRevision:2,village:{...before.village,wood:225}};
 const store=new VillageSyncProjections(async()=>after);store.remember('owner',before);
 const response=await store.commandResponse('owner',before.world.slug,commit(before),base(before),2);
 expect(response.kind).toBe('frame');if(response.kind!=='frame')throw Error('No frame');
 const applied=applyVillageFrame(before,response.frame);expect(applied.kind).toBe('applied');
 if(applied.kind==='applied')expect(applied.state).toEqual(after);
 expect((await store.commandResponse('other',before.world.slug,commit(before),base(before),2)).kind).toBe('snapshot');
 expect((await store.commandResponse('owner',before.world.slug,commit(before),{...base(before),serverTime:'2026-10-11T18:00:00Z'},2)).kind).toBe('snapshot');
});
it('replaces an in-flight precommit projection before reporting a committed command',async()=>{
 const before=fixture(),after={...before,syncRevision:2,village:{...before.village,wood:225}};
 let release!:(value:VillageState)=>void;const held=new Promise<VillageState>(r=>{release=r;});
 const load=vi.fn().mockReturnValueOnce(held).mockResolvedValue(after),store=new VillageSyncProjections(load);
 store.remember('owner',before);const idle=store.read('owner',before.world.slug,before.village.id);
 const response=store.commandResponse('owner',before.world.slug,commit(before),base(before),2);
 release(before);expect((await idle).syncRevision).toBe(1);
 const accepted=await response;expect(accepted.kind).toBe('frame');
 if(accepted.kind==='frame')expect(accepted.frame.toRevision).toBe(2);
 expect(load).toHaveBeenCalledTimes(2);
});
it('falls back coherently on evicted or unchanged bases, and refuses a stale committed result',async()=>{
 const before=fixture(),after={...before,syncRevision:2};
 const store=new VillageSyncProjections(async()=>after,{snapshots:1,contexts:1,bytes:100000});
 store.remember('owner',before);store.remember('owner',after);
 const response=await store.commandResponse('owner',before.world.slug,commit(before),base(before),2);
 expect(response.kind).toBe('snapshot');if(response.kind==='snapshot')expect(response.state).toEqual(after);
 const duplicate=await store.commandResponse('owner',before.world.slug,commit(before),base(after),2);
 expect(duplicate.kind).toBe('snapshot');
 const stale=new VillageSyncProjections(async()=>before);
 await expect(stale.commandResponse('owner',before.world.slug,commit(before),base(before),2)).rejects.toThrow('predates committed command');
});