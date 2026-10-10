import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { sampleWorldGeography } from '../packages/contracts/src/world-geography.js';
import type { GeneratedLandscape } from '../packages/contracts/src/world-generator.js';

// An illustration derived from the approved geography, never a build/spawn mask.
const source = readFileSync('apps/world-web/public/studies/t1-alpha512-rc1.json');
const checksum = createHash('sha256').update(source).digest('hex');
if (checksum !== 'de165c395c26eb70572a4370d9a537661e9eaf78b477e1694cfda283418702a4') throw Error('Unapproved atlas source');
const data = JSON.parse(source.toString()) as GeneratedLandscape;
const { width: w, height: h } = data;
const geography = { ...data.geography!, study: { ...data.geography!.study!, waterLevel: 0 } };
const heights: number[] = [], dry: number[] = [];
for (let y = 0; y <= h; y++) for (let x = 0; x <= w; x++) {
  const sample = sampleWorldGeography(geography, x % w, (h - y) % h);
  heights.push(sample.elevation); dry.push(sample.elevation - Math.max(0, sample.surface));
}
const n = (v: number) => Number(v.toFixed(2));
// Marching triangles: no ambiguous saddles, interpolated shores, shared edges.
function regions(values: number[], threshold: number) {
  const parts: string[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const corners = [[x,y], [x+1,y], [x+1,y+1], [x,y+1]].map(([px,py]) => ({ x: px!, y: py!, v: values[py! * (w+1) + px!]! - threshold }));
    if (corners.every(p => p.v <= 0)) continue;
    if (corners.every(p => p.v > 0)) {
      const start=x;
      while(x+1<w && values[y*(w+1)+x+2]!>threshold && values[(y+1)*(w+1)+x+2]!>threshold) x++;
      parts.push(`M${start} ${y}h${x-start+1}v1h-${x-start+1}z`); continue;
    }
    for (const triangle of [[corners[0]!,corners[1]!,corners[2]!],[corners[0]!,corners[2]!,corners[3]!]]) {
      const polygon: Array<{x:number;y:number}> = [];
      triangle.forEach((a, i) => {
        const b = triangle[(i+1)%3]!;
        if (a.v > 0) polygon.push(a);
        if ((a.v > 0) !== (b.v > 0)) { const t = a.v / (a.v-b.v); polygon.push({ x: a.x+(b.x-a.x)*t, y:a.y+(b.y-a.y)*t }); }
      });
      if (polygon.length) parts.push(polygon.map((p,i)=>`${i?'L':'M'}${n(p.x)} ${n(p.y)}`).join('')+'z');
    }
  }
  return parts.join('');
}
function contours(values: number[], level: number) {
  const segments: string[] = [];
  for (let y=0;y<h;y++) for(let x=0;x<w;x++) {
    const corners = [[x,y],[x+1,y],[x+1,y+1],[x,y+1]].map(([px,py])=>({x:px!,y:py!,v:values[py!*(w+1)+px!]!-level}));
    for(const tri of [[corners[0]!,corners[1]!,corners[2]!],[corners[0]!,corners[2]!,corners[3]!]]) {
      const points: Array<{x:number;y:number}>=[];
      tri.forEach((a,i)=>{const b=tri[(i+1)%3]!;if((a.v>0)!==(b.v>0)){const t=a.v/(a.v-b.v);points.push({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});}});
      if(points.length===2) segments.push(`M${n(points[0]!.x)} ${n(points[0]!.y)}L${n(points[1]!.x)} ${n(points[1]!.y)}`);
    }
  }
  return segments.join('');
}
const forest = new Map<string, {x:number;y:number}>();
for(const tree of data.forest?.trees??[]) {
  const key=`${Math.floor(tree.x/2.8)}:${Math.floor(tree.y/2.8)}`;
  if(!forest.has(key)) forest.set(key,tree);
}
const shore=contours(dry,0);
const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">
<metadata>RC1 ${checksum}; canonical y up; illustrative sampling 1 cell; no authority.</metadata>
<defs>
 <pattern id="sea" width="9" height="6" patternUnits="userSpaceOnUse"><path d="M1 3q1 .35 2 0m2 0h1" fill="none" stroke="#608b91" stroke-width=".13" opacity=".32"/></pattern>
 <symbol id="tree" viewBox="-1.8 -3.8 3.6 4.6"><path d="M0 .6v-1.3M-1.35-.65L-.5-1.5h-.7L0-3.5 1.2-1.5H.5l.85.85Z" fill="#819073" stroke="#46594b" stroke-width=".15" stroke-linejoin="round"/><path d="M0-2.8v2M-.2-1.5l-.45-.3" stroke="#485b4d" stroke-width=".12"/></symbol>
 <symbol id="rock" viewBox="-2 -2 4 3"><path d="m-1.8.5.6-1.3L.2-1.8 1.3-1l.5 1.5Z M.2-1.8-.1.5M1.3-1l-.5.4" fill="#b6ae94" stroke="#776b52" stroke-width=".18"/></symbol>
</defs>
<path fill="#b3cccb" d="M0 0H${w}V${h}H0Z"/><path fill="url(#sea)" d="M0 0H${w}V${h}H0Z"/>
<path fill="#e1dfbc" d="${regions(dry,0)}"/>
${[.6,1.3,2.2].map((v,i)=>`<path fill="${['#c8cfaa','#bac39f','#b0b996'][i]}" d="${regions(heights,v)}"/>`).join('')}
<path d="${shore}" fill="none" stroke="#6b887e" stroke-width=".45"/>
${[.5,1,1.5,2,2.5,3].map(v=>`<path d="${contours(heights,v)}" fill="none" stroke="#85866b" opacity=".45" stroke-width=".16"/>`).join('')}
${[...forest.values()].sort((a,b)=>b.y-a.y).map(t=>`<use href="#tree" x="${n(t.x-1.35)}" y="${n(h-t.y-2.8)}" width="2.7" height="3.45"/>`).join('')}
${(data.stoneSites??[]).flatMap(s=>s.rocks).map(r=>`<use href="#rock" x="${n(r.x-1.5)}" y="${n(h-r.y-1.5)}" width="3" height="2.25"/>`).join('')}
</svg>`;
mkdirSync('apps/world-web/public/atlas',{recursive:true});
writeFileSync('apps/world-web/public/atlas/rc1.svg',svg);
console.log(JSON.stringify({source:checksum,width:w,height:h,bytes:Buffer.byteLength(svg),forestSymbols:forest.size}));
