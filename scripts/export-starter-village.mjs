/* global console, URL */
import { writeFile } from 'node:fs/promises';
import { loadConfig } from '../apps/api/src/config.ts';
import { createDatabase } from '../apps/api/src/database/connection.ts';
import { translateInfrastructure } from '../apps/api/src/modules/onboarding/starter-layout.ts';

const config = loadConfig(), target = new URL(config.databaseUrl);
if (config.isProduction || target.hostname !== '127.0.0.1' || target.pathname !== '/arbestra') throw Error('Unexpected export target');
const db = createDatabase(config.databaseUrl);
try {
  const template = await db.transaction().setIsolationLevel('repeatable read').execute(async tx => {
    const village = await tx.selectFrom('villages').innerJoin('accounts', 'accounts.id', 'villages.ownerAccountId')
      .select(['villages.id', 'villages.worldId', 'villages.anchorCellX', 'villages.anchorCellY'])
      .where('accounts.email', '=', 'start@arbestra.world').executeTakeFirstOrThrow();
    const world = await tx.selectFrom('worlds').select(['widthCells','heightCells']).where('id','=',village.worldId).executeTakeFirstOrThrow();
    const delta=(n,o,size)=>((n-o+size/2)%size+size)%size-size/2;
    const source = await tx.selectFrom('buildings').selectAll().where('worldId','=',village.worldId).where('villageId','=',village.id).orderBy('buildingType').orderBy('id').execute();
    if (!source.some(b=>b.buildingType==='garden')) throw Error('Model needs its garden');
    if (source.some(b=>b.status!=='completed')) throw Error('Wait for model construction to complete');
    const buildings=[];
    for (const b of source) {
      const cells=await tx.selectFrom('worldCellOccupancies').select(['cellX','cellY','role','pendingExpansionId']).where('worldId','=',village.worldId).where('buildingId','=',b.id).orderBy('cellX').orderBy('cellY').execute();
      if (cells.some(c=>c.pendingExpansionId)) throw Error('Wait for model expansion to complete');
      buildings.push({type:b.buildingType,level:b.level,quarterTurns:b.quarterTurns,visualLayout:b.visualLayout,
        cells:cells.map(c=>({x:delta(c.cellX,village.anchorCellX,world.widthCells),y:delta(c.cellY,village.anchorCellY,world.heightCells),role:c.role}))});
    }
    const plan = (await tx.selectFrom('villageInfrastructure').select('plan').where('worldId','=',village.worldId).where('villageId','=',village.id).executeTakeFirstOrThrow()).plan;
    const infrastructure=translateInfrastructure(plan,-village.anchorCellX,-village.anchorCellY);
    infrastructure.roads.forEach((r,i)=>r.id='road-'+i);
    infrastructure.inheritedRoads.forEach((r,i)=>r.id='inherited-'+i);
    infrastructure.equipment.forEach((e,i)=>e.id='equipment-'+i);
    return {version:1,buildings,infrastructure};
  });
  await writeFile('apps/api/src/modules/onboarding/starter-village.ts', "import type { StarterVillageTemplate } from './starter-layout.js';\n\n// Frozen layout designed by Tristan on start@arbestra.world; no gameplay balances or IDs.\nexport const STARTER_VILLAGE = "+JSON.stringify(template,null,2)+" satisfies StarterVillageTemplate;\n");
  console.log(JSON.stringify({buildings:template.buildings.map(b=>({type:b.type,cells:b.cells})),roads:template.infrastructure.roads.length,equipment:template.infrastructure.equipment.length}));
} finally {await db.destroy();}
