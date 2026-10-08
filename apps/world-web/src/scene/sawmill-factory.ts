import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';

export interface SawmillMaterials { stone: StandardMaterial; lightTimber: StandardMaterial; packedEarth: StandardMaterial; sawdust: StandardMaterial; darkTimber: StandardMaterial; timber: StandardMaterial; roof: StandardMaterial; trunk: StandardMaterial }

/** Shared geometry for village, catalogue and placement. */
export function buildSawmill(scene: Scene, materials: SawmillMaterials, id: string, level: number, x = 0, z = 0, lod: 0 | 1 | 2 = 0): Mesh {
    const sides=(original:number)=>lod===2?4:lod===1?6:original;
    const foundation = MeshBuilder.CreateBox(`sawmill-${id}`, { width: 2.28, depth: 2.02, height: 0.16 }, scene);
    foundation.material = materials.stone;

    const box = (name: string, width: number, height: number, depth: number, x: number, y: number, z: number, material: StandardMaterial): Mesh => {
      const mesh = MeshBuilder.CreateBox(`${name}-${id}`, { width, height, depth }, scene);
      mesh.parent = foundation;
      mesh.position.set(x, y, z);
      mesh.material = material;
      mesh.isPickable = false;
      return mesh;
    };
    const log = (name: string, x: number, y: number, z: number, length: number, radius = 0.11, alongZ = true): Mesh => {
      const mesh = MeshBuilder.CreateCylinder(`${name}-${id}`, { height: length, diameter: radius * 2, tessellation: sides(8) }, scene);
      mesh.parent = foundation;
      mesh.position.set(x, y, z);
      mesh.rotation.x = alongZ ? Math.PI / 2 : 0;
      mesh.rotation.z = alongZ ? 0 : Math.PI / 2;
      mesh.material = materials.lightTimber;
      mesh.isPickable = false;
      return mesh;
    };
    const frame=(name:string,width:number,height:number,depth:number,x:number,y:number,z:number)=>{
      if(level>1)return box(name,width,height,depth,x,y,z,materials.darkTimber);
      const piece=MeshBuilder.CreateCylinder(`${name}-${id}`,{height:Math.max(width,height,depth),diameter:Math.min(width,height,depth),tessellation:sides(10)},scene);
      piece.parent=foundation;piece.position.set(x,y,z);piece.material=materials.darkTimber;piece.isPickable=false;
      if(width>height&&width>depth)piece.rotation.z=Math.PI/2;
      else if(depth>height)piece.rotation.x=Math.PI/2;
      return piece;
    };

    // A working yard breaks the building's footprint into the surrounding grass.
    for (const [x, z, diameter, scaleX, material, rotation] of [
      [-0.12, 0.06, 2.82, 1.08, materials.packedEarth, 0.18],
      [0.92, -0.6, 0.88, 1.3, materials.sawdust, -0.34],
      [-1.02, 0.72, 0.92, 1.42, materials.packedEarth, 0.52],
    ] as const) {
      const patch = MeshBuilder.CreateCylinder(`sawmill-yard-${id}-${x}-${z}`, { height: 0.022, diameter, tessellation: 9 }, scene);
      patch.parent = foundation;
      patch.position.set(x, -0.068, z);
      patch.scaling.x = scaleX;
      patch.rotation.y = rotation;
      patch.material = material;
      patch.isPickable = false;
    }

    // Dark rear mass and partial plank walls suggest an interior without closing the workshop.
    box('sawmill-dark-interior', 1.62, 1.02, 0.12, 0, 0.62, 0.72, materials.darkTimber);
    box('sawmill-left-wall', 0.13, 1.0, 1.38, -0.81, 0.6, 0.04, materials.timber);
    box('sawmill-right-wall', 0.13, 0.68, 1.38, 0.81, 0.44, 0.04, materials.timber);

    // Visible post-and-beam frame carries the silhouette.
    for (const x of [-0.9, 0.9]) {
      for (const z of [-0.76, 0.76]) frame('sawmill-post', 0.14, 1.46, 0.14, x, 0.78, z);
    }
    frame('sawmill-front-beam', 2.0, 0.15, 0.15, 0, 1.46, -0.76);
    frame('sawmill-back-beam', 2.0, 0.15, 0.15, 0, 1.46, 0.76);
    frame('sawmill-ridge-beam', 0.14, 0.14, 2.28, 0, 1.88, 0);

    const leftRoof = box('sawmill-roof-left', 1.3, 0.13, 2.34, -0.54, 1.65, 0, materials.roof);
    leftRoof.rotation.z = 0.5;
    const rightRoof = box('sawmill-roof-right', 1.3, 0.13, 2.34, 0.54, 1.65, 0, materials.roof);
    rightRoof.rotation.z = -0.5;

    // The open front contains an actual work platform and a readable saw station.
    box('sawmill-platform', 1.48, 0.12, 0.54, -0.06, 0.1, -0.94, materials.timber);
    box('sawmill-saw-bench', 1.18, 0.12, 0.4, 0.14, 0.59, -0.47, materials.lightTimber);
    for (const x of [-0.39, 0.67]) box('sawmill-bench-leg', 0.1, 0.48, 0.1, x, 0.34, -0.47, materials.darkTimber);
    const blade = MeshBuilder.CreateCylinder(`sawmill-blade-${id}`, { height: 0.055, diameter: 0.5, tessellation: 12 }, scene);
    blade.parent = foundation;
    blade.position.set(0.12, 0.77, -0.47);
    blade.rotation.z = Math.PI / 2;
    blade.material = materials.stone;
    blade.isPickable = false;

    // Raw timber and a stump introduce deliberate asymmetry at ground level.
    for (let index = 0; index < 4; index += 1) log('sawmill-log-pile', -1.04 + (index % 2) * 0.22, 0.18 + Math.floor(index / 2) * 0.2, 0.34, 1.22 - (index % 2) * 0.12);
    const stump = MeshBuilder.CreateCylinder(`sawmill-stump-${id}`, { height: 0.28, diameterTop: 0.42, diameterBottom: 0.5, tessellation: 9 }, scene);
    stump.parent = foundation;
    stump.position.set(1.18, 0.08, 0.83);
    stump.material = materials.trunk;
    stump.isPickable = false;

    // Higher levels grow through useful annexes, never through stacked storeys.
    if (level >= 2) {
      const leanToRoof = box('sawmill-lean-to-roof', 1.12, 0.11, 1.92, 1.26, 1.09, 0.08, materials.roof);
      leanToRoof.rotation.z = -0.2;
      for (const z of [-0.72, 0.78]) box('sawmill-lean-to-post', 0.11, 0.98, 0.11, 1.68, 0.52, z, materials.darkTimber);
      box('sawmill-drying-rack', 0.14, 0.72, 1.42, 1.42, 0.47, 0.04, materials.darkTimber);
      for (const y of [0.3, 0.55, 0.8]) log('sawmill-racked-timber', 1.38, y, 0.04, 1.28, 0.07, true);
    }

    if (level >= 3) {
      box('sawmill-roof-monitor-dark', 0.68, 0.34, 0.7, 0, 2.01, 0.26, materials.darkTimber);
      const monitorLeft = box('sawmill-roof-monitor-left', 0.5, 0.09, 0.86, -0.2, 2.27, 0.26, materials.roof);
      monitorLeft.rotation.z = 0.44;
      const monitorRight = box('sawmill-roof-monitor-right', 0.5, 0.09, 0.86, 0.2, 2.27, 0.26, materials.roof);
      monitorRight.rotation.z = -0.44;
      box('sawmill-hoist', 0.12, 0.12, 1.18, 0.6, 1.38, -1.24, materials.darkTimber).rotation.y = -0.18;
    }

    for (const [x, z, scale] of [[-1.4, -0.82, 0.18], [1.36, -0.96, 0.14], [-1.28, 1.02, 0.12]] as const) {
      const stone = MeshBuilder.CreateIcoSphere(`sawmill-yard-stone-${id}-${x}`, { radius: scale, subdivisions: 1 }, scene);
      stone.parent = foundation;
      stone.position.set(x, scale * 0.45 - 0.06, z);
      stone.scaling.y = 0.58;
      stone.rotation.y = x;
      stone.material = materials.stone;
      stone.isPickable = false;
    }

    // All workshop pieces are static. Bake their local transforms into one mesh per
    // material, while retaining the foundation as the individual building/picking root.
    const batches = new Map<StandardMaterial, Mesh[]>();
    for (const part of foundation.getChildMeshes()) {
      if (!(part instanceof Mesh)) continue;
      const material = part.material as StandardMaterial;
      const batch = batches.get(material) ?? [];
      batch.push(part); batches.set(material, batch);
    }
    for (const [material, parts] of batches) {
      if (parts.length < 2) continue;
      const merged = Mesh.MergeMeshes(parts, true, true);
      if (!merged) throw new Error('Sawmill geometry merge failed');
      merged.name = `sawmill-batch-${material.name}-${id}`;
      merged.parent = foundation; merged.isPickable = false;
    }
    foundation.position.set(x, 0.09, z);
    return foundation;
}
