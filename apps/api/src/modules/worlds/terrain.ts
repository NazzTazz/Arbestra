import {createHash} from 'node:crypto';
import {rc1ResourceGroups} from '../onboarding/rc1-field.js';
import {readRc1Ground,rc1FeatureGeometry} from './rc1-ground.js';
import { sql, type Kysely } from 'kysely';
import type { TerrainResponse, TerrainUpdatesResponse } from '@arbestra/contracts';
import type { Database } from '../../database/schema.js';
import { HttpError } from '../../errors.js';
import { normalizeCell } from './coordinates.js';
import { safeAmount } from '../deposits/stone-extractions.js';
import { knownGeography } from '../science/knowledge.js';

export function parseTerrainChunks(raw: string): Array<{ chunkX: number; chunkY: number }> {
  const entries = raw.split(';');
  if (entries.length < 1 || entries.length > 16) throw new HttpError(400, 'INVALID_CHUNKS', 'Entre 1 et 16 chunks attendus.');
  return entries.map((entry) => {
    if (!/^-?\d+,-?\d+$/.test(entry)) throw new HttpError(400, 'INVALID_CHUNKS', 'Coordonnées de chunk invalides.');
    const [chunkX, chunkY] = entry.split(',').map(Number);
    if (!Number.isSafeInteger(chunkX) || !Number.isSafeInteger(chunkY)) throw new HttpError(400, 'INVALID_CHUNKS', 'Coordonnées de chunk invalides.');
    return { chunkX: chunkX!, chunkY: chunkY! };
  });
}

export async function getTerrain(db: Kysely<Database>, accountId: string, slug: string, raw: string, preview = false): Promise<TerrainResponse> {
  return readTerrain(db, accountId, slug, raw, true, preview);
}

export async function getPreparationTerrain(db:Kysely<Database>,accountId:string,slug:string,raw:string):Promise<TerrainResponse>{return readTerrain(db,accountId,slug,raw,true,true,true);}

export async function getTerrainUpdates(db: Kysely<Database>, accountId: string, slug: string, raw: string, preview = false): Promise<TerrainUpdatesResponse> {
  const data = await readTerrain(db, accountId, slug, raw, false, preview);
  return { world: data.world, chunks: data.chunks.map(c => ({ chunkX: c.chunkX, chunkY: c.chunkY,
    originCellX: c.originCellX, originCellY: c.originCellY, ...(c.rc1?{rc1:c.rc1}:{}), features: c.features, occupiedCells: c.occupiedCells })) };
}

async function readTerrain(db: Kysely<Database>, accountId: string, slug: string, raw: string, includeGround: boolean, preview: boolean, preparation=false): Promise<TerrainResponse> {
  const requested = parseTerrainChunks(raw);
  return db.transaction().setIsolationLevel('repeatable read').execute(async (tx) => {
    await sql`set transaction read only`.execute(tx);
    const world = preparation?await tx.selectFrom('worlds').select(['id','generationVersion','generationStatus','widthCells','heightCells','chunkSize']).where('slug','=',slug).where('generationVersion','=',3).where('isOpen','=',true).executeTakeFirst():await tx.selectFrom('worlds').innerJoin('villages', 'villages.worldId', 'worlds.id')
      .innerJoin('worldMemberships', (join) => join.onRef('worldMemberships.worldId', '=', 'worlds.id').on('worldMemberships.accountId', '=', accountId))
      .select(['worlds.id', 'worlds.generationVersion', 'worlds.generationStatus', 'worlds.widthCells', 'worlds.heightCells', 'worlds.chunkSize'])
      .where('worlds.slug', '=', slug).where('villages.ownerAccountId', '=', accountId).executeTakeFirst();
    if (!world) throw new HttpError(404, 'VILLAGE_NOT_FOUND', 'Village introuvable dans ce monde.');
    const { id: worldId, chunkSize: size, widthCells: width, heightCells: height } = world;
    const knowledge = await knownGeography(tx, worldId, accountId, width, height);
    const known = (p: { cellX: number; cellY: number }) => preview || knowledge.known(p);
    if (world.generationStatus !== 'ready' || width % size || height % size) throw new HttpError(409, 'WORLD_NOT_READY', 'Terrain indisponible.');
    const wanted = [...new Map(requested.map((c) => {
      const chunkX = normalizeCell(c.chunkX, width / size), chunkY = normalizeCell(c.chunkY, height / size);
      return [`${chunkX}:${chunkY}`, { chunkX, chunkY }] as const;
    })).values()];
    const rc1=world.generationVersion===3?await readRc1Ground(tx,worldId):null;
    const halo = new Map<string, { chunkX: number; chunkY: number }>();
    if (includeGround&&!rc1) for (const c of wanted) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const chunkX = normalizeCell(c.chunkX + dx, width / size), chunkY = normalizeCell(c.chunkY + dy, height / size);
      halo.set(`${chunkX}:${chunkY}`, { chunkX, chunkY });
    }
    const rows = includeGround&&!rc1 ? await tx.selectFrom('worldChunks').selectAll().where('worldId', '=', worldId)
      .where((eb) => eb.or([...halo.values()].map((c) => eb.and([eb('chunkX', '=', c.chunkX), eb('chunkY', '=', c.chunkY)])))).execute() : [];
    if (rows.length !== halo.size || rows.some((r) => r.generationVersion !== world.generationVersion || r.terrainCodes.length !== size * size || r.elevations.length !== size * size))
      throw new HttpError(409, 'WORLD_NOT_READY', 'Terrain incomplet.');
    const byChunk = new Map(rows.map((r) => [`${r.chunkX}:${r.chunkY}`, r]));
    const ownBuildings = await tx.selectFrom('buildings').innerJoin('villages', join => join.onRef('villages.id', '=', 'buildings.villageId').onRef('villages.worldId', '=', 'buildings.worldId'))
      .select('buildings.id').where('buildings.worldId', '=', worldId).where('villages.ownerAccountId', '=', accountId).execute();
    const ownBuildingIds = new Set(ownBuildings.map(b => b.id));
    const occupancies = await tx.selectFrom('worldCellOccupancies').select(['cellX', 'cellY', 'featureId', 'buildingId']).where('worldId', '=', worldId)
      .where((eb) => eb.or(wanted.map((c) => eb.and([
        eb('cellX', '>=', c.chunkX * size), eb('cellX', '<', (c.chunkX + 1) * size),
        eb('cellY', '>=', c.chunkY * size), eb('cellY', '<', (c.chunkY + 1) * size),
      ])))).execute();
    // The deposit retains its canonical coordinates after its occupancy disappears.
    const x = sql<number>`feature_locations.cell_x`;
    const y = sql<number>`feature_locations.cell_y`;
    const features = await tx.with(cte=>cte('projectedDeposits').materialized(),eb=>eb.selectFrom('resourceDeposits').selectAll().where('worldId','=',worldId)).with('featureLocations', eb => eb.selectFrom('worldCellOccupancies')
      .select(['worldId', 'featureId', 'cellX', 'cellY']).where('featureId', 'is not', null)
      .where(sql<boolean>`not exists(select 1 from projected_deposits rd where rd.world_id=world_cell_occupancies.world_id and rd.feature_id=world_cell_occupancies.feature_id)`)
      .union(eb.selectFrom('projectedDeposits').select(['worldId', 'featureId', 'cellX', 'cellY'])))
      .selectFrom('featureLocations')
      .innerJoin('worldFeatures', join => join.onRef('worldFeatures.worldId', '=', 'featureLocations.worldId')
        .onRef('worldFeatures.id', '=', 'featureLocations.featureId'))
      .leftJoin('projectedDeposits as resourceDeposits', (join) => join.onRef('resourceDeposits.worldId', '=', 'worldFeatures.worldId').onRef('resourceDeposits.featureId', '=', 'worldFeatures.id'))
      .select(['worldFeatures.id', 'worldFeatures.featureTypeCode', 'worldFeatures.variantSeed', x.as('cellX'), y.as('cellY'),
        'resourceDeposits.initialAmount', 'resourceDeposits.remainingAmount', 'resourceDeposits.reservedAmount', 'resourceDeposits.revision', 'resourceDeposits.updatedAt', 'resourceDeposits.resourceCode', 'resourceDeposits.cleared', 'resourceDeposits.blocksCell'])
      .where('worldFeatures.worldId', '=', worldId).where((eb) => eb.or(wanted.map((c) => eb.and([
        eb(x, '>=', c.chunkX * size), eb(x, '<', (c.chunkX + 1) * size), eb(y, '>=', c.chunkY * size), eb(y, '<', (c.chunkY + 1) * size),
      ])))).execute();
    if(preparation&&rc1&&!features.length){
      for(const g of rc1ResourceGroups(rc1.data,rc1.field)){
        if(!wanted.some(c=>Math.floor(g.cellX/size)===c.chunkX&&Math.floor(g.cellY/size)===c.chunkY))continue;
        const hash=createHash('sha256').update(worldId+':'+g.sourceKey).digest('hex'),id=hash.slice(0,8)+'-'+hash.slice(8,12)+'-4'+hash.slice(13,16)+'-a'+hash.slice(17,20)+'-'+hash.slice(20,32);
        features.push({id,featureTypeCode:g.kind==='wood'?'woodland':'stone_outcrop',variantSeed:3,cellX:g.cellX,cellY:g.cellY,initialAmount:null,remainingAmount:null,reservedAmount:null,revision:null,updatedAt:null,resourceCode:null,cleared:null,blocksCell:null});
      }
    }
    const geometry=rc1?await rc1FeatureGeometry(tx,worldId,rc1.data,[...new Set(features.map(f=>f.id))]):new Map();
    if(preparation&&rc1&&features.some(f=>!f.initialAmount)){
      const groups=rc1ResourceGroups(rc1.data,rc1.field);
      for(const f of features){const g=groups.find(g=>g.cellX===f.cellX&&g.cellY===f.cellY&&(g.kind==='wood')===(f.featureTypeCode==='woodland'));if(g)geometry.set(f.id,{trees:g.treeIndices.filter(i=>!rc1.terraces.some(t=>Math.abs(rc1.data.forest!.trees[i]!.x-t.cellX)<=.5&&Math.abs(rc1.data.forest!.trees[i]!.y-t.cellY)<=.5)).map(i=>rc1.data.forest!.trees[i]!),rocks:g.sourceKey.startsWith('stone:')?rc1.data.stoneSites?.find(s=>String(s.id)===g.sourceKey.slice(6))?.rocks??[]:[]});}
    }
    return { world: { id: worldId, generationVersion: world.generationVersion, widthCells: width, heightCells: height, chunkSize: size }, chunks: wanted.map((c) => {
      const originCellX = c.chunkX * size, originCellY = c.chunkY * size;
      const terrainCodes: number[] = [], elevations: number[] = [];
      if (includeGround) for (let dy = -1; dy <= size; dy++) for (let dx = -1; dx <= size; dx++) {
        const cx = normalizeCell(originCellX + dx, width), cy = normalizeCell(originCellY + dy, height);
        if(rc1){const c=rc1.cell(cx,cy);terrainCodes.push(c.code);elevations.push(c.elevation);continue;}
        const row = byChunk.get(`${Math.floor(cx / size)}:${Math.floor(cy / size)}`)!;
        const index = (cy % size) * size + cx % size;
        terrainCodes.push(row.terrainCodes[index]!); elevations.push(row.elevations[index]!);
      }
      const inside = (p: { cellX: number; cellY: number }) => p.cellX >= originCellX && p.cellX < originCellX + size && p.cellY >= originCellY && p.cellY < originCellY + size;
      const woods = features.filter(f => f.resourceCode === 'wood');
      const occupiedCells = occupancies.filter(inside).filter(known).filter(o => {
        // Foreign settlements are dated reports, never a live occupancy feed.
        if (!preview && o.buildingId && !ownBuildingIds.has(o.buildingId)) return false;
        const wood = woods.find(w => w.id === o.featureId);
        return !wood || wood.blocksCell;
      }).map(({ cellX, cellY }) => ({ cellX, cellY }));
      for (const wood of woods.filter(inside).filter(known)) if (wood.blocksCell
        && !occupiedCells.some(o => o.cellX === wood.cellX && o.cellY === wood.cellY))
        occupiedCells.push({ cellX: wood.cellX, cellY: wood.cellY });
      return { ...c, originCellX, originCellY, terrainCodes, elevations, occupiedCells, ...(rc1?{rc1:rc1.patch(originCellX,originCellY,size)}:{}),
        features: [...new Map(features.filter(inside).map((f) => {
          const remainingAmount = f.remainingAmount === null ? null : safeAmount(f.remainingAmount);
          const reservedAmount = f.reservedAmount === null ? 0 : safeAmount(f.reservedAmount);
          return [f.id, { ...(geometry.has(f.id)?{rc1:geometry.get(f.id)}:{}), id: f.id, type: f.featureTypeCode, cellX: f.cellX, cellY: f.cellY, variantSeed: f.variantSeed,
            deposit: !known(f) || remainingAmount === null ? null : { featureId: f.id, resourceCode: f.resourceCode!, blocksCell: f.blocksCell!, cleared: f.cleared ?? false, cellX: f.cellX, cellY: f.cellY,
              initialAmount: safeAmount(f.initialAmount!), remainingAmount, reservedAmount, availableAmount: remainingAmount - reservedAmount,
              state: f.cleared || remainingAmount === 0 ? 'depleted' as const : 'available' as const, revision: safeAmount(f.revision!), updatedAt: f.updatedAt!.toISOString() } }] as const;
        })).values()] };
    }) };
  });
}
