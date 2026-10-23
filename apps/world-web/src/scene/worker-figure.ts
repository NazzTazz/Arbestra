import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Scene } from '@babylonjs/core/scene';

export const WORKER_COLOURS = {
  skin: ['#e2ba94', '#b98157', '#684532'],
  clothes: ['#42604a', '#526e86', '#b69a4c', '#a95f47', '#d9cfb4'],
  hair: ['#2d231e', '#745039', '#c4a364'],
  pants: '#4b4033',
} as const;
type BodyMaterials = {
  skin: StandardMaterial;
  clothes: StandardMaterial;
  hair: StandardMaterial;
  pants: StandardMaterial;
};
type Box = (
  name: string,
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  material: StandardMaterial,
  parent?: TransformNode,
) => Mesh;

/** Shared body proportions for animated villagers and their factory portraits. */
export function buildWorkerFigure(root: TransformNode, box: Box, materials: BodyMaterials): TransformNode[] {
  const { skin, clothes, hair, pants } = materials,
    limbs: TransformNode[] = [];
  box('body', 0.24, 0.27, 0.15, 0, 0.15, 0, clothes);
  box('head', 0.15, 0.15, 0.15, 0, 0.36, 0, skin);
  box('hair', 0.16, 0.045, 0.16, 0, 0.45, 0, hair);
  box('face', 0.055, 0.035, 0.012, 0, 0.34, 0.08, hair);
  for (const side of [-1, 1]) {
    const arm = new TransformNode(`${root.name}-arm`, root.getScene());
    arm.parent = root;
    arm.position.set(side * 0.16, 0.27, 0);
    box('arm', 0.075, 0.22, 0.075, 0, -0.11, 0, clothes, arm);
    limbs.push(arm);
  }
  for (const side of [-1, 1]) {
    const leg = new TransformNode(`${root.name}-leg`, root.getScene());
    leg.parent = root;
    leg.position.set(side * 0.065, 0.015, 0);
    box('leg', 0.085, 0.21, 0.09, 0, -0.105, 0, pants, leg);
    limbs.push(leg);
  }
  return limbs;
}

export function buildWorkerPresentation(scene: Scene, count: number): Mesh {
  const group = new Mesh(`workers-${count}`, scene);
  const material = (name: string, colour: string) => {
    const m = new StandardMaterial(name, scene);
    m.diffuseColor = Color3.FromHexString(colour);
    m.specularColor = Color3.Black();
    return m;
  };
  const skin = WORKER_COLOURS.skin.map((c, i) => material(`portrait-skin-${i}`, c)),
    clothes = WORKER_COLOURS.clothes.map((c, i) => material(`portrait-clothes-${i}`, c)),
    hair = WORKER_COLOURS.hair.map((c, i) => material(`portrait-hair-${i}`, c)),
    pants = material('portrait-pants', WORKER_COLOURS.pants);
  const positions =
    count === 1
      ? [[0, 0]]
      : count === 2
        ? [
            [-0.19, 0],
            [0.19, 0],
          ]
        : [
            [-0.28, 0.12],
            [0.28, 0.12],
            [0, -0.15],
          ];
  positions.forEach(([x, z], i) => {
    const root = new TransformNode(`portrait-${i}`, scene);
    root.parent = group;
    root.position.set(x!, 0, z!);
    root.rotation.y = Math.PI;
    const box: Box = (name, w, h, d, bx, by, bz, mat, parent = root) => {
      const mesh = MeshBuilder.CreateBox(`portrait-${i}-${name}`, { width: w, height: h, depth: d }, scene);
      mesh.parent = parent;
      mesh.position.set(bx, by, bz);
      mesh.material = mat;
      return mesh;
    };
    buildWorkerFigure(root, box, { skin: skin[i % 3]!, clothes: clothes[i % 3]!, hair: hair[i % 3]!, pants });
  });
  return group;
}
