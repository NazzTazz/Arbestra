import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import '@babylonjs/core/Meshes/Builders/boxBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Scene } from '@babylonjs/core/scene';
import type { TerrainVillageOverview } from '@arbestra/contracts';
import { RegionalBuildingModels } from './regional-building-models';
import { freezeStaticHierarchy, refreshStaticHierarchy } from './static-transforms';
import { CELL_UNITS, normalize, type WorldSpace } from './world-space';

/** Bake colored volumes into one draw mesh, without per-building nodes. */
export function volumeMesh(scene: Scene, name: string, blocks: Array<{
  x: number; z: number; y: number; width: number; depth: number; height: number; color: number[];
}>, material: StandardMaterial): Mesh {
  const positions: number[] = [], normals: number[] = [], indices: number[] = [], colors: number[] = [];
  for (const block of blocks) {
    const box = VertexData.CreateBox({ width: block.width, depth: block.depth, height: block.height });
    const base = positions.length / 3;
    for (let i = 0; i < box.positions!.length; i += 3) {
      positions.push(box.positions![i]! + block.x, box.positions![i + 1]! + block.y, box.positions![i + 2]! + block.z);
      colors.push(...block.color, 1);
    }
    normals.push(...box.normals!); indices.push(...Array.from(box.indices!, i => i + base));
  }
  const data = new VertexData(); data.positions = positions; data.normals = normals; data.indices = indices; data.colors = colors;
  const mesh = new Mesh(name, scene); data.applyToMesh(mesh); mesh.material = material; mesh.isPickable = false;
  return mesh;
}

type Village = TerrainVillageOverview['villages'][number];
type Block = Village['blocks'][number];
type Ground = (x: number, y: number) => number | null;

/** Roofed fallback for legacy reports and while a real exterior is loading. */
function silhouette(scene: Scene, name: string, block: Block, material: StandardMaterial): Mesh {
  const width = block.width * CELL_UNITS * .88, depth = block.depth * CELL_UNITS * .88;
  const garden = block.garden || block.exterior?.model === 'garden';
  const height = garden ? .12 : 1.5;
  const walls = volumeMesh(scene, name, [{ x: 0, z: 0, y: height / 2, width, depth, height,
    color: garden ? [.28, .35, .14] : [.65, .59, .46] }], material);
  if (!garden) {
    const data = VertexData.ExtractFromMesh(walls), roof = new VertexData();
    roof.positions = [-width/2,height,-depth/2, width/2,height,-depth/2, 0,height+1,-depth/2,
      -width/2,height,depth/2, width/2,height,depth/2, 0,height+1,depth/2];
    roof.indices = [0,2,1,3,4,5,0,3,5,0,5,2,1,2,5,1,5,4,0,1,4,0,4,3];
    roof.normals = []; VertexData.ComputeNormals(roof.positions, roof.indices, roof.normals);
    roof.colors = Array.from({length: 6}, () => [.48,.29,.16,1]).flat();
    data.merge(roof, true).applyToMesh(walls);
  }
  return walls;
}

export class RegionalVillages {
  readonly meshes = new Map<string, Mesh>();
  readonly #material: StandardMaterial;
  readonly #models: RegionalBuildingModels;
  readonly #signatures = new Map<string, string>();
  readonly #blocks = new Map<Mesh, { village: Village; block: Block }>();
  #queue: Array<{ parent: Mesh; placeholder: Mesh; block: Block }> = [];
  #active = 0;
  #data: TerrainVillageOverview | null = null;
  #version = -1;
  #groundVersion = -1;
  #ownVillage = '';
  #dirty = false;
  #visible = true;
  constructor(private readonly scene: Scene, private readonly ground: Ground = () => 0) {
    this.#material = new StandardMaterial('regional-villages-material', scene);
    this.#material.diffuseColor = Color3.White(); this.#material.specularColor = Color3.Black();
    this.#models = new RegionalBuildingModels(scene);
  }
  set(data: TerrainVillageOverview): void { this.#data = data; this.#dirty = true; }
  invalidateGround(): void { this.#groundVersion = -1; }
  visible(enabled: boolean): void { this.#visible = enabled; for (const root of this.meshes.values()) root.setEnabled(enabled); }

  update(space: WorldSpace, ownVillage: string, groundVersion = 0): void {
    const changed = this.#dirty || this.#ownVillage !== ownVillage;
    if (this.#data && changed) {
      const keep = new Set<string>();
      for (const village of this.#data.villages) {
        if (village.id === ownVillage) continue;
        const key = village.id ?? `silhouette-${village.anchorCellX}:${village.anchorCellY}`;
        keep.add(key);
        const signature = JSON.stringify(village);
        if (this.#signatures.get(key) === signature) continue;
        this.#remove(key);
        const root = new Mesh(`regional-village-${key}`, this.scene); root.isPickable = false;
        root.setEnabled(this.#visible);
        this.meshes.set(key, root); this.#signatures.set(key, signature);
        for (const [index, block] of village.blocks.entries()) {
          const body = new Mesh(`${root.name}-building-${index}`, this.scene); body.parent = root; body.isPickable = false;
          body.position.set(block.x * CELL_UNITS, 0, block.y * CELL_UNITS);
          this.#blocks.set(body, { village, block });
          const placeholder = silhouette(this.scene, `${body.name}-silhouette`, block, this.#material); placeholder.parent = body;
          if (block.exterior && block.exterior.model !== 'garden') {
            const model = new Mesh(`${body.name}-exterior`, this.scene); model.parent = body; model.isPickable = false;
            const e = block.exterior;
            body.rotation.y = e.quarterTurns * Math.PI / 2;
            placeholder.rotation.y = -body.rotation.y;
            model.position.x = e.offset?.[0] ?? 0; model.position.z = e.offset?.[1] ?? 0;
            // Canonical assets face -X for halls and -Z for houses. Flip the
            // visible facade without rotating a rectangular footprint sideways.
            if (e.model === 'town-hall' && e.entranceFace === '+x') model.rotation.y = Math.PI;
            else if (e.model.startsWith('dwelling') && e.entranceFace)
              model.rotation.y = ({'-z':0,'+x':-1,'+z':2,'-x':1}[e.entranceFace]) * Math.PI / 2;
            this.#queue.push({ parent: model, placeholder, block });
          }
        }
      }
      for (const key of this.meshes.keys()) if (!keep.has(key)) this.#remove(key);
      this.#queue = this.#queue.filter(item => !item.parent.isDisposed());
    }
    if (this.#data && (changed || this.#version !== space.version || this.#groundVersion !== groundVersion)) {
      for (const village of new Set([...this.#blocks.values()].map(value => value.village))) {
        const key = village.id ?? `silhouette-${village.anchorCellX}:${village.anchorCellY}`;
        const point = space.project({ cellX: village.anchorCellX, cellY: village.anchorCellY });
        this.meshes.get(key)!.position.set(point.x, 0, point.z);
      }
      for (const [body, { village, block }] of this.#blocks) {
        // Ground follows streamed terrain, including later publication/rebase.
        const cx = village.anchorCellX + block.x, cy = village.anchorCellY + block.y;
        const dx = (block.width - 1) / 2, dy = (block.depth - 1) / 2;
        const samples = [[0,0],[-dx,-dy],[dx,dy],[-dx,dy],[dx,-dy]];
        const heights = samples.map(([x,y]) => this.ground(normalize(cx+x!,space.width),normalize(cy+y!,space.height)))
          .filter((height): height is number => height !== null && Number.isFinite(height));
        body.position.y = heights.length ? Math.max(...heights) + .02 : .02;
      }
      for (const root of this.meshes.values()) freezeStaticHierarchy(root);
      this.#dirty = false; this.#version = space.version; this.#groundVersion = groundVersion; this.#ownVillage = ownVillage;
    }
    // Bound concurrent decoding/instantiation and start at most two models per
    // frame. Unchanged samples and camera rebases never rebuild the geometry.
    for (let started = 0; started < 2 && this.#active < 2 && this.#queue.length; started++) {
      const next = this.#queue.shift()!;
      if (next.parent.isDisposed()) continue;
      this.#active++;
      void this.#models.attach(next.parent, next.block.exterior!).then(() => {
        if (!next.parent.isDisposed()) {
          next.placeholder.dispose();
          const village = next.parent.parent?.parent;
          if (village instanceof Mesh) refreshStaticHierarchy(village);
        }
      }).catch(error => {
        if (!next.parent.isDisposed()) { next.parent.metadata = { exteriorError: true }; console.warn('Regional exterior unavailable; keeping silhouette', error); }
      }).finally(() => this.#active--);
    }
  }
  #remove(key: string): void {
    const root = this.meshes.get(key);
    if (root) { for (const body of this.#blocks.keys()) if (body.parent === root) this.#blocks.delete(body); root.dispose(false, false); }
    this.meshes.delete(key); this.#signatures.delete(key);
  }
  clear(): void { for (const key of this.meshes.keys()) this.#remove(key); this.#queue = []; this.#data = null; }
  dispose(): void { this.clear(); this.#models.dispose(); this.#material.dispose(); }
}
