import {loadConfig} from '../apps/api/src/config.js';
import {createDatabase} from '../apps/api/src/database/connection.js';
import {DEVELOPMENT_IDS} from '../apps/api/src/database/seed.js';
import {configureTownHallFactory} from '../apps/api/src/modules/villages/service.js';
const x=Number(process.argv[2]),y=Number(process.argv[3]);
if(!Number.isInteger(x)||!Number.isInteger(y))throw new Error('Usage: tsx scripts/configure-building-factory.ts cellX cellY [--apply]');
const db=createDatabase(loadConfig().databaseUrl);
try{console.log(JSON.stringify(await configureTownHallFactory(db,DEVELOPMENT_IDS.account,'aube',DEVELOPMENT_IDS.village,x,y,process.argv.includes('--apply'),process.argv.includes('--door=+x')?'+x':'-x')));}finally{await db.destroy();}
