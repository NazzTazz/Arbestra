/* global process,console,URL,document,fetch,performance,requestAnimationFrame,getComputedStyle,DOMPoint,innerWidth */
import { chromium,expect as baseExpect } from '@playwright/test';
const expect=baseExpect.configure({timeout:60000});
const url=new URL(process.env.SPAWN_MAP_URL??''),email=process.env.SPAWN_MAP_EMAIL,neighbor=process.env.SPAWN_MAP_NEIGHBOR_EMAIL;
if(url.origin!=='http://localhost:5274'||!url.searchParams.get('world')?.startsWith('rc1-receipt-')||!email?.endsWith('@spawn-browser.test'))throw Error('Isolated fixture required');
const browser=await chromium.launch({channel:'chrome'}),errors=[],report={};
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(60000);page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url.href);await page.evaluate(async email=>{const r=await fetch('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password:'rc1-receipt-password'})});if(!r.ok)throw Error('Login failed');},email);
 const started=performance.now();await page.reload();const map=page.locator('.atlas-canvas');await expect(map).toHaveAttribute('data-atlas-ready','true');await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));report.readyMs=Math.round(performance.now()-started);
 expect(await page.locator('canvas').count()).toBe(0);
 const screen=(x,y)=>map.evaluate((svg,p)=>{const s=new DOMPoint(p.x,256-p.y).matrixTransform(svg.getScreenCTM());return{x:s.x,y:s.y};},{x,y});
 const click=async(x,y)=>{const p=await screen(x,y);await page.mouse.click(p.x,p.y);};
 await page.screenshot({path:'test-results/spawn-atlas-global.png'});
 const v=await screen(135,80);await page.mouse.move(v.x,v.y);await expect(page.locator('.spawn-village-hover')).toHaveText('Village témoin · 15 habitants');
 expect(await page.locator('.spawn-village-hover').evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
 await click(140,20);await expect(page.locator('.atlas-coordinates')).toHaveText('140 E · 20 N');
 expect(await map.locator('*').count(),'A single kit must remain a bounded overlay, not thousands of road-pixel elements').toBeLessThan(300);
 await expect(page.getByRole('img',{name:/Courbe locale/})).toBeVisible();await expect(page.getByText('En attente d’instrumentation',{exact:true})).toHaveCount(4);
 await expect(page.locator('[aria-label="Premier sommet"]')).toHaveCount(1);await expect(page.locator('[aria-label="Premier creux"]')).toHaveCount(1);
 const curve=await page.locator('.spawn-chart-line').getAttribute('d');
 report.motionMs=[];
 for(let x=141;x<151;x++){const p=await screen(x,20),start=performance.now();await page.mouse.move(p.x,p.y);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await expect(map).toHaveAttribute('data-cursor-x',String(x));report.motionMs.push(Math.round(performance.now()-start));}
 expect(await page.locator('.spawn-chart-line').getAttribute('d')).toBe(curve);await expect(page.locator('.atlas-coordinates')).toHaveText('140 E · 20 N');
 report.overlayNodes=await map.locator('*').count();console.log(JSON.stringify({phase:'motion',...report}));
 await expect(page.getByText('Le terrain accueille les emprises du kit.',{exact:true})).toBeVisible();
 const startedCheck=performance.now();await page.getByRole('button',{name:'Vérifier cet emplacement',exact:true}).click();await expect(page.getByText('Terrain et dotation vérifiés.',{exact:true})).toBeVisible();report.preflightMs=Math.round(performance.now()-startedCheck);
 await page.screenshot({path:'test-results/spawn-atlas-selected.png'});
 await map.focus();await page.keyboard.press('r');await expect(page.getByRole('button',{name:/Tourner le kit · 90/})).toBeVisible();await page.keyboard.down('r');await page.keyboard.down('r');await page.keyboard.up('r');await expect(page.getByRole('button',{name:/Tourner le kit · 180/})).toBeVisible();
 await page.getByRole('button',{name:'Fermer le panneau'}).click();await expect(map).toBeFocused();await map.press('ArrowLeft');await map.press('Enter');await expect(page.locator('.spawn-panel')).toBeVisible();
 await page.getByRole('button',{name:'Fermer le panneau'}).click();await page.getByRole('button',{name:'Zoomer',exact:true}).click();const box=await map.boundingBox();await page.mouse.move(box.x+box.width*.4,box.y+box.height*.4);await page.mouse.down();await page.mouse.move(box.x+box.width*.5,box.y+box.height*.45,{steps:5});await page.mouse.up();await expect(page.locator('.spawn-panel')).toHaveCount(0);
 const alignment=await map.evaluate(svg=>{const r=document.querySelector('.atlas-background').getBoundingClientRect(),m=svg.getScreenCTM(),a=new DOMPoint(0,0).matrixTransform(m),b=new DOMPoint(512,256).matrixTransform(m);return Math.max(Math.abs(r.left-a.x),Math.abs(r.top-a.y),Math.abs(r.right-b.x),Math.abs(r.bottom-b.y));});expect(alignment,'Background and world picking must stay aligned through zoom and pan').toBeLessThan(.25);
 await page.getByRole('button',{name:'Vue du monde'}).click();await click(.1,.1);await expect(page.locator('.atlas-coordinates')).toHaveText('0 E · 0 N');await expect(map).toHaveAttribute('data-radius','8');await page.screenshot({path:'test-results/spawn-atlas-seam.png'});
 await page.getByRole('button',{name:'Modifier les textes'}).click();await page.getByLabel('Titre',{exact:true}).fill('Les terres du levant');await page.getByLabel('Slogan',{exact:true}).fill('Au rythme des saisons');await page.getByRole('button',{name:'Enregistrer',exact:true}).click();await expect(page.getByRole('heading',{name:'Les terres du levant'})).toBeVisible();
 await page.reload();await expect(page.getByRole('heading',{name:'Les terres du levant'})).toBeVisible();
 // Restore fixture presentation before the review capture.
 await page.getByRole('button',{name:'Modifier les textes'}).click();await page.getByLabel('Titre',{exact:true}).fill('Arbestra');await page.getByLabel('Slogan',{exact:true}).fill('Choisissez où commencer votre cité');await page.getByRole('button',{name:'Enregistrer',exact:true}).click();
 if(neighbor){
  await page.evaluate(async email=>{await fetch('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password:'rc1-receipt-password'})});},neighbor);await page.reload();await expect(map).toHaveAttribute('data-atlas-ready','true');await expect(page.getByRole('button',{name:'Modifier les textes'})).toHaveCount(0);
  await page.getByRole('button',{name:'Tracer mon territoire'}).click();for(const p of [[125,70],[145,70],[145,90],[125,90]])await click(...p);await page.getByRole('button',{name:'Enregistrer le territoire'}).click();await expect(page.getByRole('button',{name:'Effacer mon territoire'})).toBeVisible();await expect(page.locator('.atlas-territory:not(.atlas-draft)')).toHaveCount(9);await page.screenshot({path:'test-results/spawn-atlas-territory.png'});
  await page.getByRole('button',{name:'Effacer mon territoire'}).click();await expect(page.locator('.atlas-territory')).toHaveCount(0);
 }
 const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});await mobile.addCookies(await page.context().cookies());const touch=await mobile.newPage();touch.on('pageerror',e=>errors.push(e.message));await touch.goto(url.href);await expect(touch.locator('.atlas-canvas')).toHaveAttribute('data-atlas-ready','true');
 // Choose visible terrain in the middle, away from the mobile zoom controls.
 const tp=await touch.locator('.atlas-canvas').evaluate(s=>{const p=new DOMPoint(250,128).matrixTransform(s.getScreenCTM());return{x:p.x,y:p.y};});await touch.touchscreen.tap(tp.x,tp.y);await expect(touch.locator('.spawn-panel')).toBeVisible();await expect(touch.locator('.atlas-coordinates')).toHaveText('250 E · 128 N');expect(await touch.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await touch.screenshot({path:'test-results/spawn-atlas-mobile.png',fullPage:true});await mobile.close();
 expect(errors).toEqual([]);console.log(JSON.stringify({...report,errors}));
}finally{await browser.close();}
