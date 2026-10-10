import {STARTER_KIT} from './starter-kit.js';
import {planElement} from './element-plan.js';
import { planInstallation } from './installation-plan.js';
import { parentPort } from 'node:worker_threads';
import {editedRc1Field, createSpawnTerrainField, createSpawnTerrainInspector, type GeneratedLandscape } from '@arbestra/contracts';
import { artifactChecksum } from '../world-generator/artifact.js';
import { RC1_CANONICAL_CHECKSUM, type SpawnJob, type SpawnReply } from './spawn-compute-protocol.js';

let cached: { json: string; landscape: GeneratedLandscape; field: ReturnType<typeof createSpawnTerrainField> } | undefined;
parentPort!.on('message', (job: SpawnJob) => {
  let reply: SpawnReply;
  const { snapshot } = job;
  try {
    // Compare the actual JSONB snapshot, never just its declared checksum or
    // world id. One immutable RC1 field; dynamic state is supplied every time.
    if (cached?.json !== snapshot.artifactJSON) {
      const landscape = JSON.parse(snapshot.artifactJSON) as GeneratedLandscape;
      if (artifactChecksum(landscape) !== RC1_CANONICAL_CHECKSUM) throw Error('Invalid artifact');
      cached = { json: snapshot.artifactJSON, landscape, field: createSpawnTerrainField(landscape) };
    }
    if (snapshot.seed !== cached.landscape.seed) throw Error('Invalid seed');
  } catch {
    parentPort!.postMessage({ ok: false, statusCode: 409, code: 'SPAWN_MAP_NOT_READY', message: 'Cette carte d’arrivée n’est pas disponible.' } satisfies SpawnReply);
    return;
  }
  try {
    const map = { ...snapshot.map, landscape: cached.landscape };
    const result = job.kind === 'element' ? planElement(map,job.input,snapshot.spatial,cached.field) : job.kind === 'installation' ? planInstallation(map,job.input,snapshot.spatial,cached.field,snapshot.resources) : job.kind === 'map' ? map : job.kind === 'terrain'
      ? createSpawnTerrainInspector(map.landscape, editedRc1Field(map.landscape,cached.field,map.terraces??[],map.removedTreeIndices??[]))(job.input.point, map.surfaces, job.input.quarterTurns, map.villages, false, snapshot.spatial.protectedSurfaces, map.territories)
      : (()=>{const p=planInstallation(map,{...job.input,commandId:'00000000-0000-4000-8000-000000000000',kitVersion:STARTER_KIT.version,mode:'grouped',playerName:'Inspection',villageName:'Inspection'},snapshot.spatial,cached.field,snapshot.resources,false);
        return {terrain:p.terrain,readiness:'terrain-only' as const,accessRevision:1,naturalProjection:snapshot.resources?'ready' as const:'planned' as const,woodAssumption:'evaluated' as const,poorInResources:p.poorInResources,planningStatus:p.status,visited:0,plannedStone:p.supplements.filter(s=>s.kind!=='wood').reduce((n,s)=>n+s.amount,0),plannedWood:p.supplements.filter(s=>s.kind==='wood').reduce((n,s)=>n+s.amount,0),cleaning:{referenceHeight:p.cleaning.referenceHeight,treesToRemove:p.cleaning.removedTreeIndices.length,woodCredit:0 as const}};
      })();
    reply = { ok: true, result };
  } catch {
    reply = { ok: false, statusCode: 503, code: 'SPAWN_COMPUTE_FAILED', message: 'Le diagnostic a été interrompu. Réessayez.' };
  }
  parentPort!.postMessage(reply);
});
