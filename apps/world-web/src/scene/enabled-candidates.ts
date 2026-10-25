import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { Scene } from '@babylonjs/core/scene';

/**
 * Active mesh candidates without disabled meshes. Babylon checks every candidate's
 * readiness before its enabled state; inactive building LOD variants and hidden
 * terrain made most of the village's resident meshes. isEnabled() is O(1).
 */
export function selectEnabledCandidates(scene: Scene): void {
  const candidates = { data: [] as AbstractMesh[], length: 0 };
  scene.getActiveMeshCandidates = () => {
    const meshes = scene.meshes,
      data = candidates.data;
    let length = 0;
    for (let i = 0; i < meshes.length; i++) if (meshes[i]!.isEnabled()) data[length++] = meshes[i]!;
    data.length = length;
    candidates.length = length;
    return candidates;
  };
}
