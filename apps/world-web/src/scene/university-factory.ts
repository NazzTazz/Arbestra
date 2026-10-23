import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { TimberThatch } from './timber-thatch';
import { buildMathematics } from './mathematics-factory';
import { buildMedicine } from './medicine-factory';
import { buildGeography } from './geography-factory';
import { buildCampusTrees } from './campus-decoration';

/** One validated composition for both the isolated workshop and the village. */
export function buildUniversity(
  root: Mesh,
  kit: TimberThatch,
  level: number,
  phase: 'finished' | 'works',
  _sourceLevel: number,
  monuments: { mathematics: boolean; astronomy: boolean },
  previewFires = false,
) {
  // The campus uses the existing terrain as its lawn.
  buildMathematics(root, kit, level, phase, previewFires);
  buildMedicine(root, kit, level, phase);
  buildGeography(root, kit, level, phase);
  buildCampusTrees(root, kit);
  if (phase === 'finished') buildUniversityMonuments(root, kit, monuments);
  for (const child of root.getChildMeshes()) child.isPickable = false;
  return root;
}

export function buildUniversityMonuments(
  root: Mesh,
  kit: TimberThatch,
  monuments: { mathematics: boolean; astronomy: boolean },
) {
  const parts: Mesh[] = [];
  for (const [enabled, x, astronomical] of [
    [monuments.mathematics, -0.7, false],
    [monuments.astronomy, 0.7, true],
  ] as const) {
    if (!enabled) continue;
    const plinth = MeshBuilder.CreateBox(
      'university-monument-plinth',
      { width: 0.4, height: 0.24, depth: 0.4 },
      kit.scene,
    );
    plinth.position.set(x, 0.12, 1.8);
    parts.push(plinth);
    const column = MeshBuilder.CreateBox(
      'university-monument-column',
      { width: 0.15, height: 0.25, depth: 0.15 },
      kit.scene,
    );
    column.position.set(x, 0.36, 1.8);
    parts.push(column);
    const emblem = astronomical
      ? MeshBuilder.CreateTorus(
          'university-celestial-monument',
          { diameter: 0.34, thickness: 0.035, tessellation: 16 },
          kit.scene,
        )
      : MeshBuilder.CreatePolyhedron('university-mathematical-monument', { type: 2, size: 0.16 }, kit.scene);
    emblem.position.set(x, 0.61, 1.8);
    parts.push(emblem);
  }
  if (parts.length) {
    const merged = Mesh.MergeMeshes(parts, true, true);
    if (merged) {
      merged.parent = root;
      merged.material = kit.stone;
      merged.receiveShadows = true;
      merged.isPickable = false;
    }
  }
  for (const child of root.getChildMeshes()) child.isPickable = false;
  return root;
}
