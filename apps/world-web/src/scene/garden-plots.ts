import {Mesh} from '@babylonjs/core/Meshes/mesh';
import {MeshBuilder} from '@babylonjs/core/Meshes/meshBuilder';
import {VertexData} from '@babylonjs/core/Meshes/mesh.vertexData';
import type {Material} from '@babylonjs/core/Materials/material';
import type {Scene} from '@babylonjs/core/scene';

/** Scene-owned templates; each plot keeps its own transform, culling and picking. */
export class GardenPlots {
  private readonly sources = new Map<string, Mesh>();

  constructor(private readonly scene: Scene, private readonly materials: {
    soil: Material; tiles: readonly Material[]; marker: Material; stem: Material;
  }) {}

  create(id: string, x: number, z: number, ground: number, stage: number, full: boolean): Mesh {
    const plot = new Mesh(`garden-${id}`, this.scene);
    plot.position.set(x, ground + .11, z);
    const instance = (key: string, name: string, material: Material, create: () => Mesh) => {
      let source = this.sources.get(key);
      if (!source) {
        source = create(); source.name = `garden-source-${key}`; source.material = material;
        // Keep templates registered and enabled: native instances resolve lights on their source.
        source.isVisible = false; source.isPickable = false; source.receiveShadows = true;
        this.sources.set(key, source);
      }
      const mesh = source.createInstance(name); mesh.parent = plot;
      return mesh;
    };
    instance('soil', `garden-soil-${id}`, this.materials.soil, () => {
      const mesh = new Mesh('soil', this.scene);
      const base = VertexData.CreateBox({width: 2.5, depth: 2.5, height: .1});
      // The crop surface remains the sole top face, avoiding coplanar soil underneath.
      base.indices = Array.from(base.indices!).filter((_, index, indices) =>
        base.normals![indices[Math.floor(index / 3) * 3]! * 3 + 1]! < .5);
      base.applyToMesh(mesh);
      return mesh;
    });
    const surface = instance(`surface-${stage}`, `garden-surface-${id}`, this.materials.tiles[stage]!,
      () => MeshBuilder.CreateGround('surface', {width: 2.5, height: 2.5}, this.scene));
    surface.position.y = .05;
    if (full) {
      const marker = instance('marker', `garden-full-${id}`, this.materials.marker,
        () => MeshBuilder.CreateCylinder('marker', {height: .12, diameter: .62, tessellation: 16}, this.scene));
      marker.position.y = 1.05; marker.isPickable = false;
      const stem = instance('stem', `garden-full-stem-${id}`, this.materials.stem,
        () => MeshBuilder.CreateCylinder('stem', {height: .34, diameter: .08, tessellation: 8}, this.scene));
      stem.position.y = .83; stem.isPickable = false;
    }
    return plot;
  }
}
