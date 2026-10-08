/* global process, console, URL */
// Isolated production-mode API and worker for browser QA. No development data or reset.
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { createDatabase } from '../../apps/api/src/database/connection.ts';
import { testDatabaseUrl } from '../../apps/api/src/database/test-environment.ts';
import { loadConfig } from '../../apps/api/src/config.ts';
import { buildApp } from '../../apps/api/src/app.ts';
import { hashPassword } from '../../apps/api/src/security/passwords.ts';
const url=testDatabaseUrl(),u=new URL(url);
if(u.hostname!=='127.0.0.1'||u.pathname!=='/arbestra_test')throw Error('Unexpected test target');
const db=createDatabase(url),id=randomUUID(),email=id+'@preview.test',password='preview-fixture-password';
const config={...loadConfig({...process.env,DATABASE_URL:url}),isProduction:true,worldGeneratorOperatorEmails:[email]};
await db.insertInto('accounts').values({id,email,passwordHash:await hashPassword(password)}).execute();
const app=await buildApp(config,db);
const worker=spawn(process.execPath,['--import','tsx','apps/api/src/world-generator-worker.ts'],{
  windowsHide:true,stdio:['ignore','ignore','pipe'],env:{...process.env,DATABASE_URL:url,NODE_ENV:'test'},
});
worker.stderr.on('data',b=>process.stderr.write(b));
await mkdir('test-results',{recursive:true});
await writeFile('test-results/world-generator-fixture.json',JSON.stringify({email,password,id}));
await app.listen({host:'127.0.0.1',port:3180});
console.log('Production-mode preview API ready at 127.0.0.1:3180; fixture credentials saved locally.');
let stopping=false;
async function stop(){
 if(stopping)return;stopping=true;worker.kill();await new Promise(r=>worker.exitCode!==null?r():worker.once('exit',r));await app.close();
 try{
  const rows=await db.selectFrom('worldGenerationCandidates').select('worldId').where('ownerAccountId','=',id).execute();
  for(const row of rows){await db.deleteFrom('stoneDeposits').where('worldId','=',row.worldId).execute();await db.deleteFrom('woodlandDeposits').where('worldId','=',row.worldId).execute();await db.deleteFrom('worlds').where('id','=',row.worldId).execute();}
  await db.deleteFrom('accounts').where('id','=',id).execute();
 }finally{await db.destroy();}
 process.exit();
}
process.on('SIGTERM',stop);process.on('SIGINT',stop);
