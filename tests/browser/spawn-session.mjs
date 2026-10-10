// Real SpawnPlacement, controlled API and substituted App/diagnostic worker.
// No DB writes. Proves reconnection resumes the requested existing installation.
/* global process,console,URL */
import {chromium,expect} from '@playwright/test';
const url=new URL(process.env.RC1_SESSION_URL??'http://localhost:5279/spawn?world=session-fixture&x=511&y=255&turns=3&playerName=Joueur&villageName=Bressuire');
if(url.hostname!=='localhost'||url.pathname!=='/spawn')throw Error('Local spawn UI fixture only');
const browser=await chromium.launch({channel:'chrome'});
try {
 for(const expiredAt of ['starter','terrain']){
  const context=await browser.newContext(),page=await context.newPage(),errors=[],writes=[];
  let authenticated=false,logins=0,villageReads=0;
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/src/App.tsx*',r=>r.fulfill({contentType:'application/javascript',body:`
   import React from '/node_modules/.vite/deps/react.js';
   export function App({starter}){return React.createElement('main',null,'Village repris : '+starter.state.village.name+' / '+starter.state.village.id);}
  `}));
  await page.route('**/placement-worker.ts*',r=>r.fulfill({contentType:'application/javascript',body:'self.onmessage=()=>self.postMessage({ready:true});'}));
  await page.route('**/api/**',async r=>{
   const req=r.request(),path=new URL(req.url()).pathname;
   if(req.method()!=='GET')writes.push(path);
   if(path==='/api/auth/login'){
    logins++;expect(req.postDataJSON()).toEqual({email:'joueur@example.test',password:logins===1?'incorrect':'correct'});
    if(logins===1)return r.fulfill({status:401,json:{message:'Identifiants incorrects.'}});
    authenticated=true;return r.fulfill({json:{account:{id:'owner'}}});
   }
   if(!authenticated&&path.endsWith(expiredAt==='starter'?'/starter':'/starter/terrain'))return r.fulfill({status:401,json:{message:'Session invalide ou expirée.'}});
   const kit={version:1,elements:[]};
   if(path.endsWith('/starter'))return r.fulfill({json:{kit,installation:{villageId:'existing-village',anchor:{x:250,y:195},kit,remaining:[]}}});
   if(path.endsWith('/spawn-map'))return r.fulfill({json:{}});
   if(path.endsWith('/starter/terrain'))return r.fulfill({json:{}});
   if(path.endsWith('/village')){
    expect(new URL(req.url()).searchParams.get('villageId')).toBe('existing-village');villageReads++;
    return r.fulfill({json:{serverTime:'2026-10-10T18:00:00Z',village:{id:'existing-village',name:'Bressuire'},cells:[]}});
   }
   throw Error('Unexpected request '+path);
  });
  await page.goto(url.href);
  await expect(page.getByRole('heading',{name:'Reprendre votre village'})).toBeVisible();
  await page.getByLabel('Adresse e-mail').fill('joueur@example.test');
  await page.getByLabel('Mot de passe',{exact:true}).fill('incorrect');
  await page.getByRole('button',{name:'Se connecter',exact:true}).click();
  await expect(page.getByRole('alert')).toHaveText('Identifiants incorrects.');
  expect(page.url()).toBe(url.href);
  await page.getByLabel('Mot de passe',{exact:true}).fill('correct');
  await page.getByRole('button',{name:'Se connecter',exact:true}).click();
  await expect(page.getByText('Village repris : Bressuire / existing-village')).toBeVisible();
  expect(page.url()).toBe(url.href);expect(villageReads).toBeGreaterThan(0);
  expect(writes).toEqual(['/api/auth/login','/api/auth/login']);expect(errors).toEqual([]);
  await page.reload();await expect(page.getByText('Village repris : Bressuire / existing-village')).toBeVisible();
  expect(logins).toBe(2);expect(page.url()).toBe(url.href);
  console.log(JSON.stringify({expiredAt,wrongPasswordHandled:true,existingVillageResumed:true,urlPreserved:true,installationWrites:0,errors}));
  await context.close();
 }
}finally{await browser.close();}
