import {afterAll,beforeAll,expect,it} from 'vitest';
import {createDatabase} from '../../database/connection.js';
import {migrateToLatest} from '../../database/migrate.js';
import {resetE2eState} from '../../database/reset-e2e.js';
import {DEVELOPMENT_IDS} from '../../database/seed.js';
import {testDatabaseUrl} from '../../database/test-environment.js';
import {buildApp} from '../../app.js';
import {getVillageState,installDecorativeStonemason} from './service.js';

const url=testDatabaseUrl(),db=createDatabase(url),ids=DEVELOPMENT_IDS;
beforeAll(async()=>{await migrateToLatest(url);await resetE2eState(url);});
afterAll(()=>db.destroy());
it('persists exactly one decorative workshop on four free cells without costs, production or tasks',async()=>{
  const before=await getVillageState(db,ids.account,'aube',ids.village);
  const free=new Set(before.cells.filter(c=>c.canBuild).map(c=>`${c.cellX}:${c.cellY}`));
  const anchor=before.cells.find(c=>[0,1].every(dx=>[0,1].every(dy=>free.has(`${c.cellX+dx}:${c.cellY+dy}`))));
  expect(anchor).toBeDefined();
  const after=await installDecorativeStonemason(db,ids.account,'aube',ids.village,anchor!);
  const workshop=after.cells.find(c=>c.building?.type==='stonemason')!.building!;
  expect(workshop.status).toBe('completed');
  expect(after.cells.filter(c=>c.footprint?.buildingId===workshop.id)).toHaveLength(4);
  expect(after.village.resources.map(r=>[r.code,r.amount,r.productionPerHour])).toEqual(before.village.resources.map(r=>[r.code,r.amount,r.productionPerHour]));
  expect(after.buildingTypes.find(b=>b.code==='stonemason')).toMatchObject({buildable:false,productionMode:'none'});
  expect(await db.selectFrom('scheduledTasks').select('id').where('subjectId','=',workshop.id).execute()).toHaveLength(0);
  const again=await installDecorativeStonemason(db,ids.account,'aube',ids.village,anchor!);
  expect(again.cells.filter(c=>c.building?.type==='stonemason').map(c=>c.building!.id)).toEqual([workshop.id]);
  await expect(installDecorativeStonemason(db,'10000000-0000-4000-8000-000000000099','aube',ids.village,anchor!)).rejects.toThrow();
});

it('keeps decorative placement behind DEV and the enabled factory capability',async()=>{
  const config={databaseUrl:url,host:'127.0.0.1',port:0,isProduction:false,cookieName:'arbestra_session',sessionTtlDays:30,constructionDurationOverrideMs:null,scheduledTaskPollIntervalMs:25};
  const app=await buildApp(config,db),production=await buildApp({...config,isProduction:true},db);
  try {
    const login=await app.inject({method:'POST',url:'/api/auth/login',payload:{email:'player@arbestra.local',password:'arbestra'}});
    expect(login.statusCode).toBe(200);
    const header=login.headers['set-cookie'],cookie=(Array.isArray(header)?header[0]:header)!.split(';')[0]!;
    const request={method:'POST' as const,url:`/api/worlds/aube/villages/${ids.village}/buildings`,headers:{cookie},payload:{buildingType:'stonemason',cellX:1026,cellY:514}};
    expect((await production.inject(request)).statusCode).toBe(404);
    await db.insertInto('worldFactorySettings').values({worldId:ids.world,enabled:false}).onConflict(c=>c.column('worldId').doUpdateSet({enabled:false})).execute();
    expect((await app.inject(request)).statusCode).toBe(403);
    await db.updateTable('worldFactorySettings').set({enabled:true}).where('worldId','=',ids.world).execute();
    expect((await app.inject(request)).statusCode).toBe(201);
  } finally {await app.close();await production.close();}
});
