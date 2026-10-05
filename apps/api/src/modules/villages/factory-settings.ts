import {Type} from '@sinclair/typebox';
import type {FastifyInstance} from 'fastify';
import type {Kysely} from 'kysely';
import type {Database} from '../../database/schema.js';
import type {AppConfig} from '../../config.js';
import {authenticate} from '../auth/service.js';
import {HttpError} from '../../errors.js';
import {factoryCapability} from './infrastructure.js';
export async function registerFactorySettings(app:FastifyInstance,db:Kysely<Database>,config:AppConfig){
  const params=Type.Object({worldSlug:Type.String({minLength:1,maxLength:64})});
  const response=Type.Object({enabled:Type.Boolean(),canConfigure:Type.Boolean()});
  async function context(token:string|undefined,slug:string){const account=await authenticate(db,token);
    const world=await db.selectFrom('worlds').innerJoin('worldMemberships','worldMemberships.worldId','worlds.id').select('worlds.id')
      .where('worlds.slug','=',slug).where('worldMemberships.accountId','=',account.id).executeTakeFirst();
    if(!world)throw new HttpError(404,'WORLD_NOT_FOUND','Monde introuvable.');
    return {world,canConfigure:!config.isProduction};
  }
  app.get('/api/worlds/:worldSlug/factory-access',{schema:{params,response:{200:response}}},async request=>{
    const {world,canConfigure}=await context(request.cookies[config.cookieName],(request.params as {worldSlug:string}).worldSlug);return {enabled:canConfigure&&await factoryCapability(db,world.id),canConfigure:canConfigure};
  });
  app.put('/api/worlds/:worldSlug/dev/factory-access',{schema:{params,body:Type.Object({enabled:Type.Boolean()}),response:{200:response}}},async request=>{
    const {world,canConfigure}=await context(request.cookies[config.cookieName],(request.params as {worldSlug:string}).worldSlug);
    if(!canConfigure)throw new HttpError(404,'DEV_ONLY','Réglage disponible uniquement en développement.');
    const enabled=(request.body as {enabled:boolean}).enabled;
    await db.insertInto('worldFactorySettings').values({worldId:world.id,enabled}).onConflict(c=>c.column('worldId').doUpdateSet({enabled})).execute();return {enabled,canConfigure:true};
  });
}
