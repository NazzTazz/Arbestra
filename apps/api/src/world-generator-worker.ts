import { setTimeout as sleep } from 'node:timers/promises';
import { loadConfig } from './config.js';
import { createDatabase } from './database/connection.js';
import { runGenerationOnce } from './modules/world-generator/worker.js';
const config=loadConfig(),db=createDatabase(config.databaseUrl);
let stopped=false;process.on('SIGINT',()=>{stopped=true;});process.on('SIGTERM',()=>{stopped=true;});
try{while(!stopped){try{await runGenerationOnce(db,config);}catch(error){console.error(error);}if(!stopped)await sleep(1000);}}
finally{await db.destroy();}
