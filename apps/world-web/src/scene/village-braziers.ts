import {automaticBraziers,type VillageState,type TravelCell,type TravelRoute,type InfrastructurePlan,subCellKey} from '@arbestra/contracts';
import type { Scene } from '@babylonjs/core/scene';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { ClusteredLightContainer } from '@babylonjs/core/Lights/Clustered/clusteredLightContainer';
import '@babylonjs/core/Lights/Clustered/clusteredLightingSceneComponent';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { ParticleSystem } from '@babylonjs/core/Particles/particleSystem';
import '@babylonjs/core/Particles/particleSystemComponent';
import '@babylonjs/core/Shaders/particles.vertex';
import '@babylonjs/core/Shaders/particles.fragment';
import { roadEdges, roadInnerCorners } from './road-profile';
import { delta, type WorldSpace } from './world-space';

export interface BrazierPoint { x: number; y: number; z: number; seed: number;id?:string }

/** Full canonical topology, not the currently streamed subset. */
export function roadCorners(routes: readonly TravelRoute[], width: number, height: number): TravelCell[] {
  const nodes = new Map<string, { cell: TravelCell; directions: Set<string> }>();
  for (const edge of roadEdges(routes)) for (const [a, b] of [[edge.from, edge.to], [edge.to, edge.from]]) {
    const key = `${a!.cellX}:${a!.cellY}`;
    let node = nodes.get(key);
    if (!node) { node = { cell: a!, directions: new Set() }; nodes.set(key, node); }
    node.directions.add(`${Math.sign(delta(b!.cellX,a!.cellX,width))}:${Math.sign(delta(b!.cellY,a!.cellY,height))}`);
  }
  return [...nodes.values()].filter(n => n.directions.size >= 3 || n.directions.size === 2
    && !(n.directions.has('1:0') && n.directions.has('-1:0'))
    && !(n.directions.has('0:1') && n.directions.has('0:-1'))).map(n => n.cell);
}

/** Four 3×1×1 blocks in a pinwheel; the upper course reverses its handedness. */
export function brazierBlocks() {
  return [0,1].flatMap(layer => [0,1,2,3].map(i => {
    const angle = i * Math.PI / 2, sign = layer ? -1 : 1;
    return { x: (-.5 * Math.cos(angle) + 1.5 * Math.sin(angle)) * sign,
      z: -.5 * Math.sin(angle) - 1.5 * Math.cos(angle), y: layer + .5, angle: -angle };
  }));
}

/** Only called for the bounded, enabled lights. Preserve Babylon's bindings when unchanged. */
export function bindBrazierLights(lights: readonly PointLight[], meshes: readonly AbstractMesh[]): void {
  const targets = lights.map(() => [] as AbstractMesh[]);
  for (const mesh of meshes) {
    if (!mesh.isEnabled()) continue;
    const center = mesh.getBoundingInfo().boundingSphere.centerWorld;
    const near = lights.map((light, i) => ({ i, d: Vector3.DistanceSquared(center, light.position) }))
      .filter(p => p.d < 25).sort((a, b) => a.d - b.d).slice(0, 2);
    for (const p of near) targets[p.i]!.push(mesh);
    if (near.length) {
      if (mesh.material?.isFrozen) mesh.material.unfreeze();
      for (const sub of mesh.subMeshes ?? []) {
        const material = sub.getMaterial();
        if (material?.isFrozen) material.unfreeze();
      }
    }
  }
  lights.forEach((light, i) => {
    const next = targets[i]!;
    // An empty inclusion list means "all meshes" in Babylon: disable instead.
    if (light.isEnabled() !== (next.length > 0)) light.setEnabled(next.length > 0);
    if (next.length && (next.length !== light.includedOnlyMeshes.length
      || next.some((mesh, index) => mesh !== light.includedOnlyMeshes[index]))) {
      light.includedOnlyMeshes = next;
    }
  });
}

export class VillageBraziers {
  #items: Array<{ key: string; meshes: Mesh[]; flame: ParticleSystem; burning: boolean; light: PointLight; phase: number; tempo: number }> = [];
  #signature = '';
  #nextBind = 0;
  #lighting = false;
  #cluster: ClusteredLightContainer | null = null;
  #clusterChecked = false;
  readonly #stone: StandardMaterial;
  readonly #fire: DynamicTexture;
  constructor(private readonly scene: Scene) {
    this.#stone = new StandardMaterial('brazier-limestone',scene);
    this.#stone.diffuseColor = Color3.FromHexString('#c4c7cb'); this.#stone.specularColor = Color3.Black();
    this.#fire = new DynamicTexture('brazier-flame', {width:32,height:64}, scene, false);
    this.#fire.hasAlpha=true;
    const ctx=this.#fire.getContext(), pixels=new ImageData(32,64);
    for(let y=0;y<64;y++) for(let x=0;x<32;x++) {
      const t=y/63, center=16+Math.sin(t*8)*2, width=1+10*Math.sin(t*Math.PI*.9);
      const edge=Math.max(0,1-Math.abs(x-center)/width), i=(y*32+x)*4;
      pixels.data[i]=pixels.data[i+1]=pixels.data[i+2]=255;
      pixels.data[i+3]=Math.round(255*edge*edge*Math.sin(t*Math.PI));
    }
    ctx.putImageData(pixels,0,0); this.#fire.update();
  }
  update(routes: readonly TravelRoute[], space: WorldSpace,
    ground: (cell: TravelCell) => { code: number; height: number } | null, occupied: Set<string>, extraPoints: readonly BrazierPoint[] = [],plan?:InfrastructurePlan,snapshot?:VillageState,automatic?:ReturnType<typeof automaticBraziers>): void {
    const points = snapshot?(automatic??automaticBraziers(snapshot)).flatMap(e=>{const g=ground(e);if(!g)return [];const p=space.project({cellX:e.position.x/8,cellY:e.position.y/8});return [{x:p.x,y:g.height+.02,z:p.z,seed:(e.position.x*13+e.position.y*7)%97/97,id:e.id}];}):roadInnerCorners(routes,space.width,space.height).flatMap(({cell,sx,sz}) => {
      const id=`auto:${cell.cellX}:${cell.cellY}:${sx}:${sz}`;
      if(plan?.manualLighting.includes(`${cell.cellX}:${cell.cellY}`)||plan?.suppressedBraziers.includes(id))return [];
      const g = ground(cell); if (!g || g.code !== 1 || occupied.has(`${cell.cellX}:${cell.cellY}`)) return [];
      const p = space.project(cell);
      const hash=Math.sin(cell.cellX*127.1+cell.cellY*311.7+sx*19.1+sz*47.3)*43758.5453;
      const seed=hash-Math.floor(hash);
      return [{ x:p.x+sx*.80,y:g.height+.02,z:p.z+sz*.80, seed,id }];
    });
    const manual=plan?.equipment.flatMap(e=>{const key=subCellKey(e,{widthCells:space.width,heightCells:space.height}).split(':').map(Number),g=ground({cellX:key[0]!,cellY:key[1]!});if(!g)return [];const p=space.project({cellX:e.x/8,cellY:e.y/8});return [{x:p.x,y:g.height+.02,z:p.z,seed:(e.x*13+e.y*7)%97/97,id:e.id}];})??[];
    this.updatePoints([...points,...manual, ...extraPoints]);
  }
  /** Explicit decorative positions, without creating roads or resource entities. */
  updatePoints(points: readonly BrazierPoint[], parent?: Mesh): void {
    const signature = JSON.stringify(points); if (signature === this.#signature) return;
    this.#signature = signature; this.#nextBind = 0;
    const previous = new Map(this.#items.map(item => [item.key, item]));
    this.#items = [];
    for (const [index,p] of points.entries()) {
      const key = JSON.stringify(p), existing = previous.get(key);
      if (existing) { this.#items.push(existing); previous.delete(key); continue; }
      const meshes: Mesh[] = [];
      const scale=.085;
      for (const [blockIndex,block] of brazierBlocks().entries()) {
        const mesh = MeshBuilder.CreateBox('brazier-block',{width:3.25*scale,height:.65*scale,depth:.75*scale},this.scene);
        const positions=mesh.getVerticesData(VertexBuffer.PositionKind)!;
        // Identical corner coordinates get identical offsets on adjoining faces.
        for(let v=0;v<positions.length;v+=3) {
          const corner=(positions[v]!>0?1:0)+(positions[v+1]!>0?2:0)+(positions[v+2]!>0?4:0);
          for(let axis=0;axis<3;axis++) {
            const n=Math.sin((blockIndex*8+corner)*127.1+axis*311.7)*43758.5453;
            positions[v+axis]!+=(n-Math.floor(n)-.5)*scale*.12;
          }
        }
        mesh.setVerticesData(VertexBuffer.PositionKind,positions);
        const normals: number[]=[]; VertexData.ComputeNormals(positions,mesh.getIndices()!,normals);
        mesh.setVerticesData(VertexBuffer.NormalKind,normals);
        mesh.scaling.setAll(.98);
        const rim=(n:number)=>Math.sign(n)*(Math.abs(n)<1?.375:1.625)*scale;
        mesh.position.set(p.x+rim(block.x),p.y+block.y*.65*scale,p.z+rim(block.z));
        mesh.rotation.y = block.angle; mesh.material = this.#stone; mesh.isPickable = false; meshes.push(mesh);
      }
      const masonry = Mesh.MergeMeshes(meshes, true, false)!;
      masonry.name = 'brazier-masonry'; masonry.isPickable = Boolean(p.id);masonry.metadata=p.id?{equipmentId:p.id}:null;
      if (parent) masonry.setParent(parent);
      meshes.length = 0; meshes.push(masonry);
      const flame=new ParticleSystem(`brazier-fire-${index}`,24,this.scene);
      flame.particleTexture=this.#fire; flame.emitter=new Vector3(p.x,p.y+.10,p.z);
      flame.minEmitBox=new Vector3(-.006,0,-.006); flame.maxEmitBox=new Vector3(.006,.005,.006);
      flame.direction1=new Vector3(-.0115,.107,-.0115); flame.direction2=new Vector3(.0115,.183,.0115);
      flame.minEmitPower=flame.maxEmitPower=1; flame.emitRate=35;
      flame.minLifeTime=.22; flame.maxLifeTime=.45; flame.updateSpeed=1/60;
      // Stable per-location timing, including after chunk rebuilds/rebasing.
      flame.updateSpeed *= .85 + p.seed*.3;
      flame.preWarmCycles = 4 + Math.floor(p.seed*12);
      flame.preWarmStepOffset = 1;
      flame.minSize=.03; flame.maxSize=.053; flame.minScaleX=.275; flame.maxScaleX=.4;
      flame.minScaleY=1.1; flame.maxScaleY=1.6;
      flame.addSizeGradient(0,.5); flame.addSizeGradient(.3,1); flame.addSizeGradient(1,0);
      flame.addColorGradient(0,new Color4(1,.8,.28,.65));
      flame.addColorGradient(.35,new Color4(1,.38,.045,.5));
      flame.addColorGradient(1,new Color4(.6,.08,.01,0));
      flame.blendMode=ParticleSystem.BLENDMODE_ADD;
      const light = new PointLight(`brazier-light-${index}`,new Vector3(p.x,p.y+.16,p.z),this.scene);
      light.diffuse = new Color3(1,.51,.16); light.specular = Color3.Black(); light.range=5; light.intensity=0;
      light.setEnabled(false);
      if (!this.#clusterChecked) {
        this.#clusterChecked = true;
        if (ClusteredLightContainer.IsLightSupported(light)) {
          this.#cluster = new ClusteredLightContainer('village-brazier-cluster', [], this.scene);
          this.#cluster.maxRange = 5;
          // Existing frozen materials must compile the new light type once.
          for (const material of this.scene.materials) if (material.isFrozen) material.unfreeze();
        }
        const canvas=this.scene.getEngine().getRenderingCanvas();
        if(import.meta.env.DEV&&canvas)canvas.dataset.brazierLighting=this.#cluster?'clustered':'bounded';
      }
      if(this.#cluster)this.#cluster.addLight(light);
      else light.includedOnlyMeshes = meshes;
      this.#items.push({key,meshes,flame,burning:false,light,phase:p.seed*Math.PI*2,tempo:.8+p.seed*.4});
    }
    for (const item of previous.values()) {
      item.flame.dispose(false); this.#cluster?.removeLight(item.light); item.light.dispose();
      for (const mesh of item.meshes) mesh.dispose(false,false);
    }
  }
  animate(now: number, night: boolean, alpha: number): void {
    const lighting = night && alpha > 0;
    if (lighting !== this.#lighting) { this.#lighting = lighting; this.#nextBind = 0; }
    if(this.#cluster&&this.#cluster.isEnabled()!==lighting)this.#cluster.setEnabled(lighting);
    if (!this.#cluster&&!lighting) for (const item of this.#items) if (item.light.isEnabled()) item.light.setEnabled(false);
    if (alpha <= 0) {
      for (const item of this.#items) {
        item.light.intensity=0; for (const mesh of item.meshes) mesh.setEnabled(false);
        if(item.burning) { item.flame.stop(); item.flame.reset(); item.burning=false; }
      }
      this.#nextBind=0; return;
    }
    if (!this.#cluster && lighting && now >= this.#nextBind) {
      this.#nextBind=now+1000;
      const eye = this.scene.activeCamera?.globalPosition ?? Vector3.Zero();
      const active = this.#items.slice().sort((a, b) => Vector3.DistanceSquared(a.light.position, eye)
        - Vector3.DistanceSquared(b.light.position, eye)).slice(0, 6);
      const selected = new Set(active);
      for (const item of this.#items) if (!selected.has(item) && item.light.isEnabled()) item.light.setEnabled(false);
      bindBrazierLights(active.map(item => item.light), this.scene.meshes);
    }
    for (const item of this.#items) {
      const t=now*item.tempo, phase=item.phase;
      const flicker=1+.12*Math.sin(t*.011+phase)+.07*Math.sin(t*.027+phase*2.3);
      for (const mesh of item.meshes) { mesh.visibility=alpha; mesh.setEnabled(alpha>0); }
      item.flame.emitRate=(29+9*Math.sin(t*.0047+phase))*alpha;
      if(night && !item.burning) { item.flame.start(); item.burning=true; }
      if(!night && item.burning) { item.flame.stop(); item.flame.reset(); item.burning=false; }
      item.light.intensity=night ? .9*flicker*alpha : 0;
    }
  }
  #clear(): void { for (const item of this.#items) { item.flame.dispose(false); this.#cluster?.removeLight(item.light); item.light.dispose(); for (const mesh of item.meshes) mesh.dispose(false,false); } this.#items=[]; }
  dispose(): void { this.#clear(); this.#cluster?.dispose(false,true); this.#cluster=null; this.#stone.dispose(); this.#fire.dispose(); }
}
