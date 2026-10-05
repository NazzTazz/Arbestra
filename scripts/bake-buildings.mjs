import {chromium} from '@playwright/test';
import {mkdir,writeFile,readdir,unlink} from 'node:fs/promises';
import {URL} from 'node:url';
import process from 'node:process';
import {Buffer} from 'node:buffer';
import console from 'node:console';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';

// Asset compilation, not an E2E suite. Uses the real factory's canvas textures.
const browser=await chromium.launch({headless:true});
const manifest={};
const directory=new URL('../apps/world-web/public/buildings/',import.meta.url);
await mkdir(directory,{recursive:true});
try {
  const page=await browser.newPage();
  await page.route('**/__factory_bake__',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Factory asset compiler</title>'}));
  await page.goto(new URL('/__factory_bake__',process.env.FACTORY_BAKE_URL??'http://localhost:5174/').href);
  for(const [code,levels] of [['university',3],['dwelling',2],['dwelling-logs',2],['dwelling-beams',2],['town-hall',1]]) {
    for(let level=1;level<=levels;level++)for(const phase of ['finished','works']) {
      const source=await page.evaluate(async ({code,level,phase})=>{
        const {bakeBuilding}=await import('/src/scene/building-bake.ts');
        return bakeBuilding(code,level,phase);
      },{code,level,phase});
      const bytes=gzipSync(Buffer.from(source,'base64'),{level:9});
      const hash=createHash('sha256').update(bytes).digest('hex').slice(0,16);
      const key=`${code}-${level}-${phase}`,file=`${key}-${hash}.abmesh.gz`;
      await writeFile(new URL(file,directory),bytes);
      manifest[key]={url:`/buildings/${file}`,bytes:bytes.length};
      console.log(key,bytes.length);
      if(phase==='finished') {
        const png=await page.evaluate(async ({code,level})=>{
          const {renderBuildingThumbnail}=await import('/src/scene/building-thumbnail-renderer.ts');
          return renderBuildingThumbnail(code,level);
        },{code,level});
        const pixels=Buffer.from(png.split(',')[1],'base64');
        const image=`${code}-${level}-${createHash('sha256').update(pixels).digest('hex').slice(0,16)}.png`;
        await writeFile(new URL(image,directory),pixels);manifest[key].thumbnail=`/buildings/${image}`;
      }
    }
  }
  await writeFile(new URL('../apps/world-web/src/scene/building-assets-manifest.json',import.meta.url),JSON.stringify(manifest,null,2)+'\n');
  const used=new Set(Object.values(manifest).flatMap(asset=>[asset.url,asset.thumbnail].filter(Boolean).map(url=>url.split('/').at(-1))));
  for(const file of await readdir(directory))if(/^(university|dwelling(?:-logs|-beams)?|town-hall)-[1-3]-(?:finished-|works-)?[a-f0-9]{16}\.(?:(?:babylon|abmesh)\.gz|png)$/.test(file)&&!used.has(file))await unlink(new URL(file,directory));
} finally {await browser.close();}
