import { AtlasPresentationSchema, DrawSpawnTerritorySchema, insideTerritory, simpleTerritory, spawnDistance, territoriesOverlap, unwrapTerritory, type AtlasPresentation, type SpawnPoint } from '@arbestra/contracts';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { sql, type Kysely } from 'kysely';
import type { Database } from '../../database/schema.js';
import type { AppConfig } from '../../config.js';
import { authenticate } from '../auth/service.js';
import { generatorSettings } from '../world-generator/settings.js';
import { HttpError } from '../../errors.js';

export async function registerAtlasRoutes(app:FastifyInstance,db:Kysely<Database>,config:AppConfig) {
  const params=Type.Object({worldSlug:Type.String({minLength:1,maxLength:64})});
  const world=async(slug:string)=>{
    const row=await db.selectFrom('worlds').select(['id','widthCells','heightCells']).where('slug','=',slug).where('isOpen','=',true).where('generationStatus','=','ready').where('generationVersion','=',3).executeTakeFirst();
    if(!row)throw new HttpError(404,'WORLD_NOT_AVAILABLE','Monde indisponible.');return row;
  };
  app.get('/api/worlds/:worldSlug/spawn-map/presentation',{schema:{params}},async(request,reply)=>{
    const account=await authenticate(db,request.cookies[config.cookieName]);
    const current=await world((request.params as {worldSlug:string}).worldSlug);
    const presentation=await db.selectFrom('worldAtlasPresentations').select(['title','slogan']).where('worldId','=',current.id).executeTakeFirst();
    const village=await db.selectFrom('villages').select('id').where('worldId','=',current.id).where('ownerAccountId','=',account.id).executeTakeFirst();
    reply.header('cache-control','no-store');
    return {presentation:presentation??{title:'Arbestra',slogan:'Choisissez où commencer votre cité'},canEdit:generatorSettings(config).operatorEmails.includes(account.email.toLowerCase()),ownVillageId:village?.id??null};
  });
  app.put('/api/worlds/:worldSlug/spawn-map/presentation',{schema:{params,body:AtlasPresentationSchema}},async(request,reply)=>{
    const account=await authenticate(db,request.cookies[config.cookieName]);
    if(!generatorSettings(config).operatorEmails.includes(account.email.toLowerCase()))throw new HttpError(403,'OPERATOR_REQUIRED','Accès opérateur requis.');
    const current=await world((request.params as {worldSlug:string}).worldSlug);
    const input=request.body as AtlasPresentation,presentation={title:input.title.trim(),slogan:input.slogan.trim()};
    if(!presentation.title)throw new HttpError(400,'INVALID_TITLE','Le titre est requis.');
    await db.insertInto('worldAtlasPresentations').values({worldId:current.id,...presentation}).onConflict(c=>c.column('worldId').doUpdateSet(presentation)).execute();
    reply.header('cache-control','no-store');return presentation;
  });
  for(const method of ['PUT','DELETE'] as const) app.route({method,url:'/api/worlds/:worldSlug/spawn-map/territory',schema:{params,...(method==='PUT'?{body:DrawSpawnTerritorySchema}:{})},handler:async(request,reply)=>{
    const account=await authenticate(db,request.cookies[config.cookieName]);
    const current=await world((request.params as {worldSlug:string}).worldSlug);
    await db.transaction().execute(async tx=>{
      await sql`set local lock_timeout = '5s'`.execute(tx);
      const village=await tx.selectFrom('villages').select(['id','anchorCellX','anchorCellY']).where('worldId','=',current.id).where('ownerAccountId','=',account.id).forUpdate().executeTakeFirst();
      if(!village)throw new HttpError(403,'VILLAGE_REQUIRED','Seul le propriétaire d’un village peut tracer son territoire.');
      // Same world spatial serialization as installation; never acquire another village afterward.
      await sql`select pg_advisory_xact_lock(hashtextextended(${'infrastructure:'+current.id},0))`.execute(tx);
      if(method==='DELETE'){await tx.deleteFrom('villageSpawnTerritories').where('worldId','=',current.id).where('villageId','=',village.id).execute();return;}
      const hall={x:village.anchorCellX,y:village.anchorCellY},raw=(request.body as {points:SpawnPoint[]}).points;
      const points=unwrapTerritory(raw,hall,current.widthCells,current.heightCells);
      if(points.some(p=>spawnDistance(p,hall,current.widthCells,current.heightCells)>30+1e-8)||!simpleTerritory(points)||!insideTerritory(hall,points,current.widthCells,current.heightCells))
        throw new HttpError(400,'INVALID_TERRITORY','Tracez un contour simple contenant votre HDV, à 30 cases maximum de celui-ci.');
      const others=await tx.selectFrom('villageSpawnTerritories').select('points').where('worldId','=',current.id).where('villageId','!=',village.id).execute();
      if(others.some(t=>territoriesOverlap(points,t.points,current.widthCells,current.heightCells)))throw new HttpError(409,'TERRITORY_OVERLAP','Ce tracé rencontre le territoire d’un autre village.');
      const neighbors=await tx.selectFrom('villages').select(['anchorCellX','anchorCellY']).where('worldId','=',current.id).where('id','!=',village.id).execute();
      if(neighbors.some(v=>insideTerritory({x:v.anchorCellX,y:v.anchorCellY},points,current.widthCells,current.heightCells)))throw new HttpError(409,'TERRITORY_OCCUPIED','Ce tracé englobe un autre hôtel de ville.');
      const stored=JSON.stringify(points);
      await tx.insertInto('villageSpawnTerritories').values({worldId:current.id,villageId:village.id,points:stored}).onConflict(c=>c.column('villageId').doUpdateSet({points:stored})).execute();
    });
    reply.header('cache-control','no-store');return {ok:true};
  }});
}
