import {expect,it,vi} from 'vitest';
import {ApiError,type TimedVillageState} from '../api/client';
import {GardenHarvestQueue,type HarvestIntent} from './garden-harvest-queue';
const plot={worldSlug:'aube',villageId:'village',buildingId:'garden',cellX:4,cellY:5};
const snapshot={} as TimedVillageState;
it('collects and deduplicates the gesture before sending one mission on release',async()=>{
  const send=vi.fn().mockResolvedValue(snapshot),accepted=vi.fn();
  const queue=new GardenHarvestQueue({send,accepted,changed:vi.fn(),warning:vi.fn()});
  queue.enqueue(plot,true);queue.enqueue({...plot,cellX:5},false);queue.enqueue(plot,false);
  await queue.settled();expect(send).not.toHaveBeenCalled();expect(queue.pending()).toHaveLength(2);
  queue.finishGesture();await queue.settled();
  expect(send).toHaveBeenCalledTimes(1);expect(send.mock.calls[0]![0].targets.map((p:typeof plot)=>p.cellX)).toEqual([4,5]);
  expect(accepted).toHaveBeenCalledTimes(1);expect(queue.pending()).toEqual([]);
});
it('retries the whole uncertain selection with the same receipt before a later gesture',async()=>{
  const sent:HarvestIntent[]=[],warning=vi.fn();let lost=true;
  const queue=new GardenHarvestQueue({accepted:vi.fn(),changed:vi.fn(),warning,send:async intent=>{
    sent.push({...intent});if(lost){lost=false;throw new TypeError('lost response');}return snapshot;
  }});
  queue.enqueue(plot,true);queue.enqueue({...plot,cellX:5},false);queue.finishGesture();await queue.settled();
  expect(queue.pending().map(p=>p.status)).toEqual(['uncertain','uncertain']);
  queue.enqueue({...plot,cellX:6},true);queue.finishGesture();queue.retry();await queue.settled();
  expect(sent.map(i=>i.targets.map(p=>p.cellX))).toEqual([[4,5],[4,5],[6]]);
  expect(sent[0]!.commandId).toBe(sent[1]!.commandId);expect(warning).toHaveBeenCalledTimes(1);
  expect(queue.pending()).toEqual([]);
});
it('cancels an unfinished gesture and permits another after an atomic rejection',async()=>{
  const send=vi.fn().mockRejectedValueOnce(new ApiError('empty',409,'GARDEN_EMPTY')).mockResolvedValue(snapshot);
  const queue=new GardenHarvestQueue({send,accepted:vi.fn(),changed:vi.fn(),warning:vi.fn()});
  queue.enqueue(plot,true);queue.cancelGesture();queue.finishGesture();await queue.settled();expect(send).not.toHaveBeenCalled();
  queue.enqueue(plot,true);queue.enqueue({...plot,cellX:5},false);queue.finishGesture();await queue.settled();expect(queue.pending()).toEqual([]);
  queue.enqueue({...plot,cellX:6},true);queue.finishGesture();await queue.settled();expect(send).toHaveBeenCalledTimes(2);
});
