import { AssetContainer } from '@babylonjs/core/assetContainer';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';
import type { Material } from '@babylonjs/core/Materials/material';
import type { BaseTexture } from '@babylonjs/core/Materials/Textures/baseTexture';
import type { TerrainBuildingExterior } from '@arbestra/contracts';
import { buildingAssets, instantiateBakedBuilding, loadBakedBuilding } from './building-assets';
import { buildPresentation } from './building-presentation';
import { batchDistantBuilding } from './building-lod-geometry';
import { TimberThatch } from './timber-thatch';

/** Regional exteriors share the game's recipes, at fixed distant quality.
 * No inhabitants, effects, scientific monuments or economic animation. */
export class RegionalBuildingModels {
  readonly #templates = new Map<string, AssetContainer>();
  readonly #materials = new Set<Material>();
  readonly #textures = new Set<BaseTexture>();
  #kit: TimberThatch | null = null;
  constructor(private readonly scene: Scene) {}

  async attach(parent: Mesh, exterior: TerrainBuildingExterior): Promise<void> {
    if (parent.isDisposed()) return;
    const key = `${exterior.model}-${exterior.level}-${exterior.phase}`;
    const distant = `${key}-lod2`;
    if (buildingAssets[distant]) await loadBakedBuilding(parent, distant);
    else {
      let template = this.#templates.get(key);
      if (!template) {
        const materials = new Set(this.scene.materials), textures = new Set(this.scene.textures);
        this.#kit ??= new TimberThatch(this.scene); this.#kit.lod = 2;
        const root = buildPresentation(this.#kit, exterior.model, exterior.level, exterior.phase);
        batchDistantBuilding(root);
        template = new AssetContainer(this.scene);
        template.meshes.push(root, ...root.getChildMeshes().filter((mesh): mesh is Mesh => mesh instanceof Mesh));
        template.removeAllFromScene(); this.#templates.set(key, template);
        for (const material of this.scene.materials) if (!materials.has(material)) this.#materials.add(material);
        for (const texture of this.scene.textures) if (!textures.has(texture)) this.#textures.add(texture);
      }
      instantiateBakedBuilding(template, parent);
    }
    if (parent.isDisposed()) return;
    for (const mesh of parent.getChildMeshes()) mesh.isPickable = false;
  }

  dispose(): void {
    for (const template of this.#templates.values()) template.dispose();
    this.#templates.clear();
    for (const material of this.#materials) material.dispose();
    for (const texture of this.#textures) texture.dispose();
    this.#materials.clear(); this.#textures.clear();
  }
}
