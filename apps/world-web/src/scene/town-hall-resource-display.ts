import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { BuildingGeometry } from './building-geometry';
import { TimberThatch, timberBeamGeometry } from './timber-thatch';

/** Decorative samples behind the market pavilion's glazed facade. */
export function buildResourceDisplay(parent: Mesh, kit: TimberThatch, floor: number) {
  const root = new Mesh('market-resource-display', kit.scene);
  root.parent = parent;
  root.position.y = floor;
  const batches = new Map<StandardMaterial, BuildingGeometry[]>(),
    owned: StandardMaterial[] = [];
  const material = (name: string, colour: string, wood = false) => {
    const m = new StandardMaterial(`market-display-${name}`, kit.scene);
    m.diffuseColor = Color3.FromHexString(colour);
    m.specularColor = Color3.Black();
    m.diffuseTexture = wood ? kit.wood.diffuseTexture : kit.stone.diffuseTexture;
    owned.push(m);
    return m;
  };
  const darkStone = material('dark-stone', '#65717c'),
    lightStone = material('light-stone', '#e3d8bf'),
    brick = material('red-brick', '#b75638');
  const boards = material('boards', '#d9b379', true),
    bark = material('raw-logs', '#775034', true),
    ends = material('log-ends', '#e3c08b', true),
    beams = material('beams', '#ae8251', true);
  const add = (piece: BuildingGeometry, m: StandardMaterial) => {
    const batch = batches.get(m) ?? [];
    batch.push(piece);
    batches.set(m, batch);
    return piece;
  };
  const box = (name: string, x: number, y: number, z: number, w: number, h: number, d: number, m: StandardMaterial) => {
    const piece = new BuildingGeometry(name, timberBeamGeometry(h, w, d, m !== boards, 1));
    piece.position.set(x, y, z);
    return add(piece, m);
  };
  const z = 0.52,
    top = 0.18;
  // Six low wooden stands keep every sample above the glazed bay's stone sill.
  const xs = [-1.15, -0.69, -0.23, 0.23, 0.69, 1.15];
  for (const x of xs) {
    box('display-stand-top', x, top - 0.02, z, 0.4, 0.04, 0.6, kit.wood);
    for (const dx of [-0.15, 0.15])
      box('display-stand-leg', x + dx, (top - 0.04) / 2, z, 0.05, top - 0.04, 0.44, kit.wood);
  }
  for (const [index, m] of [
    [0, darkStone],
    [1, lightStone],
  ] as const) {
    for (let row = 0; row < 3; row++)
      for (let col = 0; col < 2; col++)
        box(
          'display-finished-stone',
          xs[index]! + (col - 0.5) * 0.175,
          top + (row + 0.5) * 0.105,
          z,
          0.168,
          0.1,
          0.29,
          m,
        );
  }
  for (let row = 0; row < 4; row++)
    for (let col = 0; col < 3; col++)
      box(
        'display-red-brick',
        xs[2]! + (col - 1) * 0.108 + (row % 2 ? 0.015 : 0),
        top + (row + 0.5) * 0.057,
        z,
        0.102,
        0.052,
        0.23,
        brick,
      );
  for (let row = 0; row < 5; row++)
    for (let col = 0; col < 3; col++)
      box('display-sawn-board', xs[3]! + (col - 1) * 0.105, top + (row + 0.5) * 0.035, z, 0.1, 0.029, 0.54, boards);
  for (let row = 0; row < 3; row++)
    for (let col = 0; col < 3 - row; col++) {
      const x = xs[4]! + (col - (2 - row) / 2) * 0.115,
        y = top + 0.058 + row * 0.1;
      const log = BuildingGeometry.cylinder('display-raw-log', { height: 0.54, diameter: 0.112, tessellation: 10 });
      log.position.set(x, y, z);
      log.rotation.x = Math.PI / 2;
      add(log, bark);
      for (const side of [-1, 1]) {
        const end = BuildingGeometry.cylinder('display-log-cut-end', {
          height: 0.006,
          diameter: 0.103,
          tessellation: 10,
        });
        end.position.set(x, y, z + side * 0.271);
        end.rotation.x = Math.PI / 2;
        add(end, ends);
      }
    }
  for (let row = 0; row < 3; row++)
    for (let col = 0; col < 2; col++)
      box('display-square-beam', xs[5]! + (col - 0.5) * 0.15, top + (row + 0.5) * 0.108, z, 0.143, 0.102, 0.54, beams);
  for (const [m, parts] of batches) {
    const mesh = new Mesh(`market-display-batch-${m.name}`, kit.scene);
    BuildingGeometry.merge(parts).applyToMesh(mesh);
    mesh.parent = root;
    mesh.material = m;
    mesh.receiveShadows = true;
    mesh.isPickable = false;
  }
  root.onDisposeObservable.addOnce(() => {
    for (const m of owned) m.dispose();
  });
  return root;
}
