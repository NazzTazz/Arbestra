import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import '@babylonjs/core/Meshes/Builders/boxBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Scene } from '@babylonjs/core/scene';
import type { TerrainVillageOverview } from '@arbestra/contracts';
import { CELL_UNITS, type WorldSpace } from './world-space';

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

export class RegionalVillages {
  readonly meshes = new Map<string, Mesh>();
  readonly #material: StandardMaterial;
  #data: TerrainVillageOverview | null = null;
  #version = -1;
  #dirty = false;
  constructor(private readonly scene: Scene) {
    this.#material = new StandardMaterial('regional-villages-material', scene);
    this.#material.diffuseColor = Color3.White(); this.#material.specularColor = Color3.Black();
  }
  set(data: TerrainVillageOverview): void { this.#data = data; this.#dirty = true; }
  update(space: WorldSpace, ownVillage: string, blend: number): void {
    if (this.#data && (this.#dirty || this.#version !== space.version)) {
      for (const mesh of this.meshes.values()) mesh.dispose(); this.meshes.clear();
      for (const village of this.#data.villages) {
        const p = space.project({ cellX: village.anchorCellX, cellY: village.anchorCellY });
        const blocks = village.blocks.map(b => ({ x: p.x + b.x * CELL_UNITS, z: p.z + b.y * CELL_UNITS,
          y: b.garden ? .12 : 1.3, width: b.width * CELL_UNITS * .94, depth: b.depth * CELL_UNITS * .94,
          height: b.garden ? .18 : b.underConstruction?1.8:2.5, color: b.garden ? [.38, .24, .12] : b.underConstruction?[.54,.45,.32]:[.44, .24, .12] }));
        if (blocks.length) this.meshes.set(village.id, volumeMesh(this.scene, `regional-village-${village.id}`, blocks, this.#material));
      }
      this.#dirty = false; this.#version = space.version;
    }
    for (const [id, mesh] of this.meshes) { mesh.visibility = id === ownVillage ? blend : 1; mesh.setEnabled(id !== ownVillage || blend > 0); }
  }
  clear(): void { for (const mesh of this.meshes.values()) mesh.dispose(); this.meshes.clear(); this.#data = null; }
  dispose(): void { this.clear(); this.#material.dispose(); }
}
