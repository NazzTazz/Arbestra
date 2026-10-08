import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { sql, type Kysely } from 'kysely';
import type { Database } from '../../database/schema.js';
import type { AppConfig } from '../../config.js';
import { generatorSettings } from './settings.js';
export async function runGenerationOnce(db:Kysely<Database>,config:AppConfig):Promise<boolean>{
  const settings=generatorSettings(config);
  return db.connection().execute(async connection=>{
    const lock=await sql<{locked:boolean}>`select pg_try_advisory_lock(hashtextextended('world-generator-executor',0)) as locked`.execute(connection);
    if(!lock.rows[0]?.locked)return false;
    try{
      await db.updateTable('worldGenerationCandidates').set({status:'failed',error:'Generation interrupted: expired executor heartbeat.',finishedAt:new Date()})
        .where('status','=','running').where('heartbeatAt','<',new Date(Date.now()-settings.staleMs)).execute();
      const stillRunning=await db.selectFrom('worldGenerationCandidates').select('worldId').where('status','=','running').executeTakeFirst();
      if(stillRunning)return false;
      const row=await db.transaction().execute(async tx=>{
        const pending=await tx.selectFrom('worldGenerationCandidates').select(['worldId','attempt']).where('status','=','pending').orderBy('createdAt').forUpdate().skipLocked().executeTakeFirst();
        if(!pending)return null;
        return tx.updateTable('worldGenerationCandidates').set({status:'running',attempt:pending.attempt+1,heartbeatAt:new Date(),startedAt:new Date(),error:null})
          .where('worldId','=',pending.worldId).returning(['worldId','attempt']).executeTakeFirstOrThrow();
      });
      if(!row)return false;
      const extension=import.meta.url.endsWith('.ts')?'.ts':'.js';
      const child=spawn(process.execPath,[`--max-old-space-size=${settings.memoryMb}`,...(extension==='.ts'?['--import','tsx']:[]),
        fileURLToPath(new URL('./generate-child'+extension,import.meta.url)),row.worldId,String(row.attempt)],{stdio:['ignore','ignore','pipe'],windowsHide:true,env:{...process.env,DATABASE_URL:config.databaseUrl}});
      let diagnostic='',timedOut=false,heartbeatStopped=false;
      child.stderr?.on('data',chunk=>{diagnostic=(diagnostic+String(chunk)).slice(-1500);});
      const heartbeat=(async()=>{while(!heartbeatStopped){await sleep(settings.heartbeatMs);if(!heartbeatStopped)
        await db.updateTable('worldGenerationCandidates').set({heartbeatAt:new Date()}).where('worldId','=',row.worldId).where('attempt','=',row.attempt).where('status','=','running').execute();}})().catch(error=>{diagnostic='Executor heartbeat failed: '+String(error);child.kill();});
      const timeout=setTimeout(()=>{timedOut=true;child.kill();},settings.timeoutMs);
      const shutdown=()=>child.kill();process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);
      let code:number|null=null;
      try {code=await new Promise<number|null>((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});}
      catch(error){diagnostic=String(error);}
      finally {clearTimeout(timeout);heartbeatStopped=true;process.off('SIGTERM',shutdown);process.off('SIGINT',shutdown);await heartbeat;}
      if(code!==0)await db.updateTable('worldGenerationCandidates').set({status:'failed',finishedAt:new Date(),error:timedOut?'Generation time limit exceeded.':diagnostic||'Generation process failed.'})
        .where('worldId','=',row.worldId).where('attempt','=',row.attempt).where('status','=','running').execute();
      return true;
    }finally{await sql`select pg_advisory_unlock(hashtextextended('world-generator-executor',0))`.execute(connection);}
  });
}
