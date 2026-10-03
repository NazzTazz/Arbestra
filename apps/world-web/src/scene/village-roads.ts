import type { TravelCell, TravelRoute } from '@arbestra/contracts';
import type { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { WorldSpace } from './world-space';
import { CELL_UNITS } from './world-space';
import '@babylonjs/core/Meshes/Builders/boxBuilder';

import { type RoadKind, roadKey as key, roadEdges, pavedProfiles, roadTileRects, roadTileBorders } from './road-profile';
export { roadEdges } from './road-profile';

const noise = (x: number, y: number) => {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
};

/** Rounded plan corners and a small bevel, batched into the road mesh. */
function roundedSlab(width: number, depth: number, height: number): VertexData {
  const radius = Math.min(.035,width/4,depth/4), bevel=.004;
  const outline: Array<[number,number]> = [];
  for (let corner=0;corner<4;corner++) {
    const angle=corner*Math.PI/2;
    const cx=(corner===0||corner===3?1:-1)*(width/2-radius);
    const cz=(corner<2?1:-1)*(depth/2-radius);
    for(let step=0;step<=3;step++) {
      const a=angle+step*Math.PI/6;
      outline.push([cx+Math.cos(a)*radius,cz+Math.sin(a)*radius]);
    }
  }
  const positions:number[]=[],indices:number[]=[], count=outline.length;
  for(let ring=0;ring<3;ring++) for(const [x,z] of outline) {
    positions.push(x*(ring===2?(width-2*bevel)/width:1),
      ring===0?-height/2:ring===1?height/2-bevel:height/2,
      z*(ring===2?(depth-2*bevel)/depth:1));
  }
  for(let ring=0;ring<2;ring++) for(let i=0;i<count;i++) {
    const next=(i+1)%count, a=ring*count+i,b=ring*count+next;
    indices.push(a,b,b+count,a,b+count,a+count);
  }
  const top=positions.length/3; positions.push(0,height/2,0);
  for(let i=0;i<count;i++) indices.push(top,2*count+i,2*count+(i+1)%count);
  const data=new VertexData(); data.positions=positions; data.indices=indices;
  return data;
}

/** Decorative surfaces of the authoritative route network; never changes journey time. */
export class VillageRoads {
  readonly #materials: Record<RoadKind, StandardMaterial>;
  readonly #curb: StandardMaterial;
  #meshes: Mesh[] = [];
  #signature = '';
  #requestSignature = '';
  constructor(private readonly scene: Scene) {
    const makeEarth = () => {
      const texture = new DynamicTexture('road-earth', { width: 128, height: 256 }, scene, true);
      const ctx = texture.getContext();
      ctx.fillStyle = '#765338'; ctx.fillRect(0, 0, 128, 256);
      for (let i = 0; i < 1800; i++) {
        const x = noise(i, 1) * 128, y = noise(i, 2) * 256;
        ctx.fillStyle = i % 2 ? '#876346' : '#69492f'; ctx.globalAlpha = .22;
        ctx.fillRect(x, y, 1 + noise(i, 3) * 3, 1 + noise(i, 4) * 4);
      }
      ctx.globalAlpha = 1;
      texture.update();
      const material = new StandardMaterial('road-earth', scene);
      material.diffuseTexture = texture; material.specularColor = Color3.Black();
      material.backFaceCulling = false; material.zOffset = -1;
      return material;
    };
    const paving = new StandardMaterial('road-paved-stone', scene);
    paving.diffuseColor = Color3.FromHexString('#aeb0ac'); paving.specularColor = Color3.Black();
    this.#materials = { paved: paving, earth: makeEarth() };
    this.#curb = new StandardMaterial('road-curb-stone', scene);
    this.#curb.diffuseColor = Color3.FromHexString('#c4c7cb');
    this.#curb.specularColor = Color3.Black();
  }
  update(signature: string, routes: readonly TravelRoute[], space: WorldSpace,
    ground: (cell: TravelCell) => { code: number; height: number } | null): void {
    if (signature === this.#requestSignature) return;
    this.#requestSignature = signature;
    // Streamer revisions also change when unrelated tiles enter the frustum.
    // Keep the existing meshes unless their own topology/height/projection changes.
    const edges = roadEdges(routes).filter(e => [e.from, e.to].every(c => ground(c)?.code === 1));
    const geometrySignature = JSON.stringify([space.width, space.height, space.origin,
      routes.map(route => [route.kind, route.cells]),
      edges.map(e => [e.from, e.to, e.kind, ground(e.from)?.height, ground(e.to)?.height])]);
    if (geometrySignature === this.#signature) return;
    this.#signature = geometrySignature;
    for (const mesh of this.#meshes) mesh.dispose(false, false);
    this.#meshes = [];
    const groups = { paved: { positions: [] as number[], indices: [] as number[], uvs: [] as number[] },
      earth: { positions: [] as number[], indices: [] as number[], uvs: [] as number[] } };
    const curbPositions: number[] = [], curbIndices: number[] = [];
    // One batch for all small stones, no per-stone mesh/light/material.
    const curbRow = (x: number, z: number, dx: number, dz: number, length: number, fallbackHeight: number,
      startMiter: number, endMiter: number) => {
      const count = Math.max(1, Math.round(length / .24)), step = length / count;
      for (let i = 0; i < count; i++) {
        const cx = x + dx * step * (i + .5), cz = z + dz * step * (i + .5);
        const cell = space.inverse(cx, cz), seed = cell.cellX * 31 + cell.cellY * 17 + i;
        const box = VertexData.CreateBox({ width: step - .004, height: .085, depth: .13 });
        const base = curbPositions.length / 3, y = (ground(cell)?.height ?? fallbackHeight) - .034;
        for (let v = 0; v < box.positions!.length; v += 3) {
          let bx = box.positions![v]!, by = box.positions![v+1]!, bz = box.positions![v+2]!;
          const corner = (bx > 0 ? 1 : 0) + (by > 0 ? 2 : 0) + (bz > 0 ? 4 : 0);
          const endFace = bx > 0;
          // Trim/extend only the end face to meet the adjoining row on a diagonal.
          if(i===0 && !endFace) bx+=startMiter*(.065-bz);
          if(i===count-1 && endFace) bx+=endMiter*(.065-bz);
          bx += (noise(seed + corner, 1) - .5) * .002;
          by += (noise(seed + corner, 2) - .5) * .002;
          bz += (noise(seed + corner, 3) - .5) * .002;
          curbPositions.push(cx + dx * bx - dz * bz, y + by, cz + dz * bx + dx * bz);
        }
        for (const index of box.indices!) curbIndices.push(base + index);
      }
    };
    const junctions = new Map<string, { cell: TravelCell; kind: RoadKind }>();
    for (const edge of edges) for (const cell of [edge.from, edge.to]) {
      if (junctions.get(key(cell))?.kind !== 'paved') junctions.set(key(cell), { cell, kind: edge.kind });
    }
    const halfWidth = (cell: TravelCell) => junctions.get(key(cell))?.kind === 'paved' ? .47 : .4;
    for (const { from, to, kind } of edges) {
      const a = ground(from), b = ground(to);
      if (!a || !b || a.code !== 1 || b.code !== 1) continue;
      const [start, end] = space.path([from, to]);
      const dx = end!.x - start!.x, dz = end!.z - start!.z, length = Math.hypot(dx, dz);
      if (length < .01 || length > CELL_UNITS * 1.01) continue;
      if (kind === 'paved') continue;
      const group = groups.earth;
      // Separate the two tile surfaces exactly at their boundary. A ramp between
      // sampled elevations used to pass under the higher tile and disappear.
      const startT = junctions.get(key(from))?.kind === 'paved' ? .5 : halfWidth(from)/length;
      const endT = junctions.get(key(to))?.kind === 'paved' ? .5 : 1-halfWidth(to)/length;
      for (const [lo,hi,height] of [[startT,.5,a.height],[.5,endT,b.height]]) {
        if (hi! <= lo!) continue;
        const base = group.positions.length/3;
        for(let i=0;i<=4;i++) {
          const t=lo!+(hi!-lo!)*i/4, x=start!.x+dx*t, z=start!.z+dz*t;
          const cell=space.inverse(x,z);
          for(const side of [-1,1]) {
            const width=i===0||i===4?.4:.35+noise(Math.round(cell.cellX*16),Math.round(cell.cellY*16)+side*17)*.05;
            const px=x-dz/length*width*side, pz=z+dx/length*width*side;
            group.positions.push(px,height!+.012,pz);
            group.uvs.push(px/(CELL_UNITS/2)+space.origin.cellX*2,pz/(CELL_UNITS/2)+space.origin.cellY*2);
          }
          if(i) { const p=base+(i-1)*2; group.indices.push(p,p+2,p+1,p+1,p+2,p+3); }
        }
      }
      // A small earthen riser closes terrain steps, instead of a floating bridge.
      if(startT<.5 && endT>.5 && a.height!==b.height) {
        const x=(start!.x+end!.x)/2,z=(start!.z+end!.z)/2,base=group.positions.length/3;
        for(const y of [a.height+.012,b.height+.012]) for(const side of [-1,1]) {
          const px=x-dz/length*.4*side,pz=z+dx/length*.4*side;
          group.positions.push(px,y,pz); group.uvs.push(px/(CELL_UNITS/2)+space.origin.cellX*2,pz/(CELL_UNITS/2)+space.origin.cellY*2);
        }
        group.indices.push(base,base+1,base+2,base+1,base+3,base+2);
      }
    }
    // Fill corners and shared junctions once, with paving taking precedence.
    for (const { cell, kind } of junctions.values()) {
      const p = space.project(cell), w = halfWidth(cell), y = ground(cell)!.height + .012;
      if (kind === 'paved') continue;
      const group = groups[kind], base = group.positions.length / 3;
      group.positions.push(p.x-w,y,p.z-w, p.x-w,y,p.z+w, p.x+w,y,p.z-w, p.x+w,y,p.z+w);
      for(const [x,z] of [[p.x-w,p.z-w],[p.x-w,p.z+w],[p.x+w,p.z-w],[p.x+w,p.z+w]]) {
        group.uvs.push(x!/(CELL_UNITS/2)+space.origin.cellX*2,z!/(CELL_UNITS/2)+space.origin.cellY*2);
      }
      group.indices.push(base,base+2,base+1, base+1,base+2,base+3);
    }
    for (const [id, mask] of pavedProfiles(routes, space.width, space.height)) {
      const [cellX, cellY] = id.split(':').map(Number), cell = { cellX:cellX!, cellY:cellY! };
      const g = ground(cell); if (!g || g.code !== 1) continue;
      const p = space.project(cell), group = groups.paved;
      const patches = roadTileRects(mask).filter(r => r.dug);
      // Merge coplanar adjacent pieces before laying slabs, avoiding artificial seams at the tile centre.
      let merged = true;
      while (merged) {
        merged = false;
        outer: for (let i=0;i<patches.length;i++) for (let j=i+1;j<patches.length;j++) {
          const a=patches[i]!, b=patches[j]!;
          if (a.x0===b.x0 && a.x1===b.x1 && (a.z1===b.z0 || b.z1===a.z0)
            || a.z0===b.z0 && a.z1===b.z1 && (a.x1===b.x0 || b.x1===a.x0)) {
            patches[i]={x0:Math.min(a.x0,b.x0),x1:Math.max(a.x1,b.x1),z0:Math.min(a.z0,b.z0),z1:Math.max(a.z1,b.z1),dug:true};
            patches.splice(j,1); merged=true; break outer;
          }
        }
      }
      for (const r of patches) {
        const alongX = r.x1-r.x0 > r.z1-r.z0;
        const length = alongX ? r.x1-r.x0 : r.z1-r.z0, width = alongX ? r.z1-r.z0 : r.x1-r.x0;
        const columns=Math.max(1,Math.round(width/.47)), rows=2*Math.max(1,Math.round(length/1.175));
        const sw=width/columns, sl=length/rows, thickness=.047;
        for(let row=0;row<rows;row++) for(let col=0;col<columns;col++) {
          const x=p.x+r.x0+(alongX?(row+.5)*sl:(col+.5)*sw);
          const z=p.z+r.z0+(alongX?(col+.5)*sw:(row+.5)*sl);
          const box=roundedSlab((alongX?sl:sw)-.008,(alongX?sw:sl)-.008,thickness);
          const base=group.positions.length/3;
          for(let v=0;v<box.positions!.length;v+=3) {
            group.positions.push(x+box.positions![v]!,g.height-.025-thickness/2+box.positions![v+1]!,z+box.positions![v+2]!);
          }
          for(const index of box.indices!) group.indices.push(base+index);
        }
      }
      const borders=roadTileBorders(mask);
      for (const e of borders) {
        const length = Math.hypot(e.x1-e.x0,e.z1-e.z0), dx=(e.x1-e.x0)/length, dz=(e.z1-e.z0)/length;
        const miter=(x:number,z:number)=>{
          const other=borders.find(b=>b!==e && (b.x0===x&&b.z0===z || b.x1===x&&b.z1===z));
          return other ? other.nx*dx+other.nz*dz : 0;
        };
        curbRow(p.x+e.x0+e.nx*.065,p.z+e.z0+e.nz*.065,
          dx,dz,length,g.height,miter(e.x0,e.z0),miter(e.x1,e.z1));
      }
    }
    for (const kind of ['paved', 'earth'] as const) {
      const group = groups[kind]; if (!group.indices.length) continue;
      const mesh = new Mesh(`village-road-${kind}`, this.scene), data = new VertexData();
      data.positions = group.positions; data.indices = group.indices; data.uvs = group.uvs;
      data.normals = []; VertexData.ComputeNormals(data.positions, data.indices, data.normals);
      data.applyToMesh(mesh); mesh.material = this.#materials[kind]; mesh.isPickable = false;
      this.#meshes.push(mesh);
    }
    if (curbIndices.length) {
      const mesh = new Mesh('village-road-curbs', this.scene), data = new VertexData();
      data.positions = curbPositions; data.indices = curbIndices; data.normals = [];
      VertexData.ComputeNormals(curbPositions, curbIndices, data.normals);
      data.applyToMesh(mesh); mesh.material = this.#curb; mesh.isPickable = false;
      this.#meshes.push(mesh);
    }
  }
  show(alpha: number): void { for (const mesh of this.#meshes) { mesh.visibility = alpha; mesh.setEnabled(alpha > 0); } }
  dispose(): void {
    for (const mesh of this.#meshes) mesh.dispose(false, false);
    for (const material of Object.values(this.#materials)) material.dispose(false, true);
    this.#curb.dispose();
  }
}
