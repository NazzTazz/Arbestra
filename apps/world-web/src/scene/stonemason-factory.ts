import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { CreateIcoSphereVertexData } from '@babylonjs/core/Meshes/Builders/icoSphereBuilder';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { VillageBraziers } from './village-braziers';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { BuildingGeometry } from './building-geometry';
import { timberBeamGeometry, type TimberThatch } from './timber-thatch';
import { buildingPlan, HALL_RECIPE } from './building-plan';

/** Visual recipe only: a 2 × 2 yard, open towards local -Z. */
export function buildStonemason(root: Mesh, kit: TimberThatch, phase: 'finished' | 'works', previewFires = true) {
  const works = phase === 'works';
  const batches = new Map<StandardMaterial, BuildingGeometry[]>();
  const add = (piece: BuildingGeometry, material: StandardMaterial, shade = 1) => {
    piece.data.colors = Array.from({ length: piece.getTotalVertices() }, () => [shade, shade, shade, 1]).flat();
    const batch = batches.get(material) ?? []; batch.push(piece); batches.set(material, batch);
    return piece;
  };
  const box = (name: string, size: readonly [number, number, number], position: readonly [number, number, number], material: StandardMaterial) => {
    const piece = BuildingGeometry.box(name, { width: size[0], height: size[1], depth: size[2] });
    piece.position.set(...position); return add(piece, material);
  };
  const stone = (name: string, x: number, y: number, z: number, width: number, height: number, depth: number, shade = 1) => {
    const piece = new BuildingGeometry(name, timberBeamGeometry(height, width, depth, true, 2));
    piece.position.set(x, y, z); return add(piece, kit.stone, shade);
  };
  const rawStone = (x: number, y: number, z: number, radius: number, seed: number) => {
    const data = CreateIcoSphereVertexData({ radius, subdivisions: 1, flat: true });
    const positions = data.positions!;
    for (let i = 0; i < positions.length; i += 3) {
      const variation = .9 + .12 * Math.sin(positions[i]! * 17 + positions[i + 2]! * 23 + seed);
      positions[i] = positions[i]! * variation; positions[i + 1] = positions[i + 1]! * .72;
      positions[i + 2] = positions[i + 2]! * variation;
    }
    const normals: number[] = []; VertexData.ComputeNormals(positions, data.indices!, normals); data.normals = normals;
    const piece = new BuildingGeometry('stonemason-rough-stone', data);
    piece.position.set(x, y, z); piece.rotation.y = seed; add(piece, kit.stone, .75 + seed % .12);
  };

  // An irregular dusty apron fits entirely inside the four reserved cells.
  const dust = new StandardMaterial('stonemason-yard-earth', kit.scene);
  dust.diffuseColor = Color3.FromHexString('#91806a'); dust.specularColor = Color3.Black();
  root.onDisposeObservable.addOnce(() => dust.dispose());
  const yard = new VertexData();
  const edge = [[-2.3, -1.8], [-1.9, -2.28], [.6, -2.35], [2.25, -1.9], [2.35, .1],
    [2.2, 2.23], [.5, 2.35], [-2.25, 2.18], [-2.35, .2]];
  yard.positions = [0, .018, 0, ...edge.flatMap(([x, z]) => [x!, .018, z!])];
  yard.indices = edge.flatMap((_, i) => [0, 1 + i, 1 + (i + 1) % edge.length]);
  yard.normals = Array.from({ length: edge.length + 1 }, () => [0, 1, 0]).flat();
  yard.uvs = Array.from({ length: edge.length + 1 }, () => [0, 0]).flat();
  add(new BuildingGeometry('stonemason-yard', yard), dust);

  // A rectangular rear wall and exactly two front piers support the standard roof.
  const courses = works ? 11 : 16, courseHeight = .14, joint = .003;
  for (let row = 0; row < courses; row++) {
    let start = -1.96;
    while (start < 1.96 - joint) {
      const end = Math.min(1.96, start + (start === -1.96 && row % 2 ? .21 : .42));
      stone('stonemason-rear-wall', (start + end) / 2, (row + .5) * courseHeight, 1.85,
        end - start - joint, courseHeight - joint, .28, .94 + row % 3 * .02);
      start = end;
    }
    // One square block per course forms each slender front support.
    for (const x of [-1.65, 1.65])
      stone('stonemason-stone-pier', x, (row + .5) * courseHeight, -.25,
        .14 - joint, courseHeight - joint, .14 - joint, .96);

  }
  // Side walls have genuine open semicircular arches, including wedge-shaped voussoirs.
  const spring = 1.12, innerRadius = .7, outerRadius = .9, centre = .8;
  const crownHalf = outerRadius * Math.sin(Math.PI / 22);
  const crownBottom = spring + outerRadius * Math.cos(Math.PI / 22);
  const crownRow = Math.floor(crownBottom / courseHeight);
  for (const x of [-1.85, 1.85]) {
    for (let row = 0; row < courses; row++) {
      const bottom = row * courseHeight;
      const gap = bottom < spring ? outerRadius : Math.sqrt(Math.max(0, outerRadius ** 2 - (bottom - spring) ** 2));
      const spans = gap > 0 ? [[-.32, centre - gap], [centre + gap, 1.92]] : [[-.32, 1.92]];
      for (const [lo, hi] of spans) {
        let start = lo!;
        while (start < hi! - joint) {
          const end = Math.min(hi!, start + .42);
          const cutLeft = row !== crownRow && gap > 0 && hi! < centre && end === hi;
          const cutRight = row !== crownRow && gap > 0 && lo! > centre && start === lo;
          if (cutLeft || cutRight) {
            const piece = BuildingGeometry.box('stonemason-arch-wall-cut',
              { width: .28, height: courseHeight - joint, depth: end - start - joint });
            const positions = piece.data.positions!, mid = (start + end) / 2;
            for (let i = 0; i < positions.length; i += 3) {
              if (cutLeft ? positions[i + 2]! <= 0 : positions[i + 2]! >= 0) continue;
              const y = (row + .5) * courseHeight + positions[i + 1]!;
              const halfOpening = y < spring ? outerRadius : Math.sqrt(Math.max(0, outerRadius ** 2 - (y - spring) ** 2));
              positions[i + 2] = centre + (cutLeft ? -1 : 1) * (halfOpening + joint / 2) - mid;
            }
            const normals: number[] = []; VertexData.ComputeNormals(positions, piece.data.indices!, normals);
            piece.data.normals = normals; piece.position.set(x, (row + .5) * courseHeight, mid);
            add(piece, kit.stone, .96);
          } else stone('stonemason-side-wall', x, (row + .5) * courseHeight, (start + end) / 2,
            .28, courseHeight - joint, end - start - joint, .96);
          start = end;
        }
      }
    }
    if (!works) {
      // A rectangular crown block and two trapezoids close the apex without pinched triangles.
      const bottom = crownRow * courseHeight, top = (crownRow + 1) * courseHeight - joint / 2;
      const extent = Math.sqrt(outerRadius ** 2 - (bottom - spring) ** 2);
      stone('stonemason-arch-crown-rectangle', x, (crownBottom + top) / 2, centre,
        .28, top - crownBottom - joint / 2, crownHalf * 2 - joint, .96);
      for (const side of [-1, 1]) {
        const lo = centre + side * crownHalf, hi = centre + side * extent;
        const piece = BuildingGeometry.box('stonemason-arch-crown-trapezoid',
          { width: .28, height: 1, depth: Math.abs(hi - lo) - joint });
        const positions = piece.data.positions!, mid = (lo + hi) / 2;
        for (let i = 0; i < positions.length; i += 3) {
          const inner = positions[i + 2]! * side < 0;
          positions[i + 1] = positions[i + 1]! > 0 ? top : (inner ? crownBottom : bottom) + joint / 2;
        }
        const normals: number[] = []; VertexData.ComputeNormals(positions, piece.data.indices!, normals);
        piece.data.normals = normals; piece.position.set(x, 0, mid); add(piece, kit.stone, .96);
      }
    }
    const visibleHeight = courses * courseHeight;
    for (const sign of [-1, 1]) for (let row = 0; row < Math.min(courses, 8); row++)
      stone('stonemason-arch-jamb', x, (row + .5) * courseHeight,
        centre + sign * (innerRadius + outerRadius) / 2, .3, courseHeight - joint, outerRadius - innerRadius - joint, .99);
    if (visibleHeight >= spring + outerRadius) for (let segment = 0; segment < 11; segment++) {
      const a = segment * Math.PI / 11 + .003, b = (segment + 1) * Math.PI / 11 - .003;
      const piece = BuildingGeometry.box('stonemason-arch-voussoir', { width: .3, height: 1, depth: 1 });
      const positions = piece.data.positions!;
      for (let i = 0; i < positions.length; i += 3) {
        const radius = positions[i + 1]! > 0 ? outerRadius : innerRadius;
        const angle = positions[i + 2]! > 0 ? a : b;
        positions[i + 1] = spring + Math.sin(angle) * radius;
        positions[i + 2] = centre + Math.cos(angle) * radius;
      }
      const normals: number[] = []; VertexData.ComputeNormals(positions, piece.data.indices!, normals);
      piece.data.normals = normals; piece.position.x = x; add(piece, kit.stone, segment === 5 ? 1 : .97);
    }
  }
  const roof = new Mesh('stonemason-canopy', kit.scene); roof.parent = root; roof.position.z = .8;
  const plan = buildingPlan({ id: 'stonemason-canopy', anchor: { cellX: 0, cellY: 0 },
    cells: [{cellX:0,cellY:0},{cellX:1,cellY:0},{cellX:0,cellY:1},{cellX:1,cellY:1}],
    world: { widthCells: 100, heightCells: 100 }, phase, sourceLevels: 0,
    recipe: { ...HALL_RECIPE, id: 'stonemason-canopy', modules: [14, 8], courses: 16,
      entrance: { ...HALL_RECIPE.entrance, enabled: false }, windows: {},
      roof: { ...HALL_RECIPE.roof, maxSpan: 4, slope: 25, frameMaterial:'logs' } } });
  kit.buildRoof(roof, plan);
  for (const mesh of roof.getChildMeshes()) { mesh.isPickable = false; mesh.receiveShadows = true; }

  // Left: rough stock. Centre: three benches. Right: stacked, usable ashlar.
  for (const [i, x, z, radius] of [[0, -1.7, -1.45, .42], [1, -1.13, -1.7, .36], [2, -1.65, -.92, .3], [3, -1.6, -1.4, .28]])
    rawStone(x!, i === 3 ? .68 : radius! * .72 + .02, z!, radius!, i! * .8);
  if (!works) {
    for (const [station, x] of [-1.25, 0, 1.25].entries()) {
      for (const legX of [-.28, .28]) for (const legZ of [-.19, .19])
        box('stonemason-bench-leg', [.09, .48, .09], [x + legX, .26, .65 + legZ], kit.wood);
      box('stonemason-bench-top', [.78, .1, .62], [x, .55, .65], kit.wood);
      if (station === 0) rawStone(x, .82, .65, .27, 1.7);
      else stone('stonemason-workpiece', x, .76, .65, .48, .32, .34, station === 1 ? .85 : .98);
      // Mallet and chisel rest beside the workpiece, readable from above.
      box('stonemason-mallet-handle', [.045, .035, .24], [x - .26, .62, .48], kit.wood).rotation.y = -.35;
      box('stonemason-mallet-head', [.15, .08, .08], [x - .3, .66, .4], kit.wood);
      box('stonemason-chisel', [.028, .025, .24], [x + .29, .615, .65], kit.nails).rotation.y = .4;
      for (let chip = 0; chip < 6; chip++) rawStone(x - .35 + chip * .13, .04, .05 + chip % 2 * .11, .035 + chip % 3 * .009, chip + station * 3);
    }
    // Rotate the whole large-block stack together, preserving its staggered courses.
    const stockAngle = -35 * Math.PI / 180, c = Math.cos(stockAngle), s = Math.sin(stockAngle);
    const stock = (x: number, y: number, z: number) => {
      const dx = x - 1.35, dz = z + 1.3;
      stone('stonemason-finished-stock', 1.35 + c * dx + s * dz, y,
        -1.3 - s * dx + c * dz, .42, .225, .32, .98).rotation.y = stockAngle;
    };
    for (let row = 0; row < 3; row++) for (let column = 0; column < (row === 2 ? 2 : 3); column++)
      stock(.8 + column * .43 + row % 2 * .1, .12 + row * .23, -1.45);
    for (let column = 0; column < 3; column++) stock(.85 + column * .43, .12, -1.08);
    // A smaller brick-shaped stock sits at the centre of the front apron.
    for (let row = 0; row < 3; row++) for (let rank = 0; rank < 2; rank++)
      for (let column = 0; column < 4 - row; column++)
        stone('stonemason-small-brick-stock', -.44 + column * .27 + row * .12,
          .075 + row * .105, -1.5 + rank * .135, .26, .1, .125, .96 + row * .015);
  } else {
    for (let i = 0; i < 4; i++) box('stonemason-construction-timber', [1.25, .09, .12], [.75, .07 + i * .09, -1.2], kit.wood);
  }

  for (const [material, pieces] of batches) {
    const mesh = new Mesh(`stonemason-${material.name}`, kit.scene);
    BuildingGeometry.merge(pieces).applyToMesh(mesh); mesh.material = material;
    mesh.parent = root; mesh.isPickable = false; mesh.receiveShadows = true;
  }
  if (!works && previewFires) {
    const braziers = new VillageBraziers(kit.scene);
    const point = Vector3.TransformCoordinates(new Vector3(-1.18, .02, -.45), root.computeWorldMatrix(true));
    braziers.updatePoints([{ x: point.x, y: point.y, z: point.z, seed: .4 }], root);
    const observer = kit.scene.onBeforeRenderObservable.add(() => braziers.animate(performance.now(), true, 1));
    root.onDisposeObservable.addOnce(() => { kit.scene.onBeforeRenderObservable.remove(observer); braziers.dispose(); });
  }
  return root;
}
