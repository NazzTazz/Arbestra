import {createSpawnTerrainField,editedRc1Field, createSpawnTerrainInspector, type SpawnMap, type SpawnPoint } from '@arbestra/contracts';

type Inspection = { kind: 'inspect'; channel: 'disk' | 'selection'; sequence: number; point: SpawnPoint; turns: number };
let map: SpawnMap | undefined;
let inspect: ReturnType<typeof createSpawnTerrainInspector> | undefined;
const pending = new Map<Inspection['channel'], Inspection>();
let scheduled = false;
self.onmessage = (event: MessageEvent<{ kind: 'init'; map: SpawnMap } | Inspection>) => {
  const message = event.data;
  if (message.kind === 'init') {
    map = message.map; inspect = createSpawnTerrainInspector(map.landscape,editedRc1Field(map.landscape,createSpawnTerrainField(map.landscape),map.terraces??[],map.removedTreeIndices??[]));
    self.postMessage({ channel: 'ready' });
    return;
  }
  pending.set(message.channel, message);
  if (scheduled) return; scheduled = true;
  setTimeout(() => {
    scheduled = false;
    const tasks = [...pending.values()]; pending.clear();
    if (!map || !inspect) return;
    for (const task of tasks) {
      const started = performance.now();
      const result = inspect(task.point, map.surfaces, task.turns, map.villages, task.channel === 'disk', [], map.territories);
      self.postMessage({ channel: task.channel, sequence: task.sequence, result, milliseconds: performance.now() - started });
    }
  }, 0);
};
