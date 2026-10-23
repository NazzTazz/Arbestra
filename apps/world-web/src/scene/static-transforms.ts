import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Scene } from '@babylonjs/core/scene';

const roots = new WeakSet<TransformNode>();
const dynamic = new WeakSet<TransformNode>();
const revisions = new WeakMap<Scene, number>();

/** Exclude an animated branch, including children whose world pose follows it. */
export function keepWorldMatrixDynamic(root: TransformNode): void {
  dynamic.add(root);
}
export function staticTransformRevision(scene: Scene): number {
  return revisions.get(scene) ?? 0;
}

/** Opt-in only: callers own invalidation after changing pose, parent or geometry. */
export function freezeStaticHierarchy(root: TransformNode): void {
  roots.add(root);
  const visit = (node: TransformNode) => {
    if (dynamic.has(node) || node.billboardMode || node.infiniteDistance || node.animations.length) return;
    // freezeWorldMatrix recomputes even an already frozen matrix. Parent first:
    // computeWorldMatrix(true) alone does not bypass Babylon's frozen fast path.
    node.freezeWorldMatrix();
    for (const child of node.getChildren(undefined, true)) if (child instanceof TransformNode) visit(child);
  };
  visit(root);
  revisions.set(root.getScene(), staticTransformRevision(root.getScene()) + 1);
}

/** Also admits late-loaded LOD children; previews never opt in and stay mobile. */
export function refreshStaticHierarchy(root: TransformNode): void {
  if (roots.has(root) && !root.isDisposed()) freezeStaticHierarchy(root);
}
