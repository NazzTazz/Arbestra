import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { timberBeamGeometry, type TimberThatch } from './timber-thatch';

/** Visual recipes only. In particular, logs does not introduce an economic stock. */
export const RESOURCE_RECIPES = [
  { code: 'stone', label: 'Pierre brute' },
  { code: 'cut-stone', label: 'Pierre taillée' },
  { code: 'wood', label: 'Bois brut' },
  { code: 'logs', label: 'Rondins' },
  { code: 'timber', label: 'Bois d’œuvre' },
  { code: 'carrot', label: 'Carottes' },
] as const;
export type ResourceRecipeCode = (typeof RESOURCE_RECIPES)[number]['code'];
export function isResourceRecipe(code: string): code is ResourceRecipeCode {
  return RESOURCE_RECIPES.some((recipe) => recipe.code === code);
}

export function buildResourcePresentation(kit: TimberThatch, code: ResourceRecipeCode): Mesh {
  const { scene } = kit;
  const root = new Mesh(`resource-${code}`, scene);
  const owned: StandardMaterial[] = [];
  root.onDisposeObservable.add(() => {
    for (const material of owned) material.dispose(false, true);
  });
  const piece = (name: string, length: number, width: number, depth: number, material: StandardMaterial) => {
    const mesh = new Mesh(name, scene);
    timberBeamGeometry(length, width, depth).applyToMesh(mesh);
    mesh.parent = root;
    mesh.material = material;
    return mesh;
  };
  if (code === 'stone') {
    // Separate angular fragments, rather than a deposit or a manufactured block.
    for (const [i, [x, y, z, size]] of (
      [
        [-0.48, 0.42, -0.22, 0.48],
        [0.46, 0.35, -0.24, 0.4],
        [0, 0.31, 0.45, 0.36],
        [-0.08, 0.9, -0.05, 0.34],
      ] as const
    ).entries()) {
      const rock = MeshBuilder.CreateIcoSphere(`raw-stone-${i}`, { radius: size, subdivisions: 1, flat: true }, scene);
      const positions = [...rock.getVerticesData(VertexBuffer.PositionKind)!];
      for (let v = 0; v < positions.length; v += 3) {
        // A coordinate-based deformation keeps coincident vertices together.
        const factor = 1 + 0.13 * Math.sin(positions[v]! * 17 + positions[v + 1]! * 23 + positions[v + 2]! * 31 + i);
        positions[v]! *= factor;
        positions[v + 1]! *= factor;
        positions[v + 2]! *= factor;
      }
      const normals: number[] = [];
      VertexData.ComputeNormals(positions, rock.getIndices()!, normals);
      rock.setVerticesData(VertexBuffer.PositionKind, positions);
      rock.setVerticesData(VertexBuffer.NormalKind, normals);
      rock.scaling.set(1.12, 0.9, 1);
      rock.rotation.set(0.12 * i, 0.6 * i, -0.13 * i);
      rock.position.set(x!, y!, z!);
      rock.parent = root;
      rock.material = kit.stone;
      const tint = 0.68 + i * 0.05;
      rock.setVerticesData(
        VertexBuffer.ColorKind,
        Array.from({ length: rock.getTotalVertices() }, () => [tint, tint * 0.99, tint * 0.94, 1]).flat(),
      );
    }
  } else if (code === 'cut-stone') {
    for (let i = 0; i < 5; i++) {
      const block = piece(`cut-stone-${i}`, 0.36, 0.8, 0.48, kit.stone);
      block.position.set(i < 3 ? (i - 1) * 0.84 : (i - 3.5) * 0.84, i < 3 ? 0.18 : 0.56, i < 3 ? 0 : 0.04);
      block.rotation.y = i === 4 ? -0.06 : 0;
    }
  } else if (code === 'timber') {
    for (let i = 0; i < 6; i++) {
      const board = piece(`sawn-timber-${i}`, 2.4 - (i % 3) * 0.08, 0.34, 0.13, kit.wood);
      board.rotation.x = Math.PI / 2;
      board.position.set(((i % 3) - 1) * 0.38, 0.065 + Math.floor(i / 3) * 0.16, Math.floor(i / 3) * 0.16);
    }
    const beam = piece('sawn-timber-beam', 2.1, 0.25, 0.25, kit.wood);
    beam.rotation.set(Math.PI / 2, -0.17, 0);
    beam.position.set(0.12, 0.43, -0.06);
  } else if (code === 'carrot') {
    const orange = new StandardMaterial('resource-carrot-orange', scene);
    orange.diffuseColor = Color3.FromHexString('#e7802e');
    orange.specularColor = Color3.Black();
    const green = new StandardMaterial('resource-carrot-leaves', scene);
    green.diffuseColor = Color3.FromHexString('#508638');
    green.specularColor = Color3.Black();
    owned.push(orange, green);
    for (let i = 0; i < 5; i++) {
      const carrot = new Mesh(`resource-carrot-${i}`, scene);
      carrot.parent = root;
      carrot.position.set(((i % 3) - 1) * 0.42, 0.32 + Math.floor(i / 3) * 0.25, (i % 2) * 0.22);
      carrot.rotation.set(Math.PI / 2, (i - 2) * 0.17, 0);
      const body = MeshBuilder.CreateCylinder(
        `carrot-body-${i}`,
        { height: 1.3, diameterTop: 0.3, diameterBottom: 0.025, tessellation: 8 },
        scene,
      );
      body.parent = carrot;
      body.material = orange;
      for (let j = 0; j < 3; j++) {
        const leaf = MeshBuilder.CreateBox(`carrot-leaf-${i}-${j}`, { width: 0.09, height: 0.52, depth: 0.04 }, scene);
        leaf.parent = carrot;
        leaf.position.set((j - 1) * 0.1, 0.86, 0);
        leaf.rotation.z = (j - 1) * -0.4;
        leaf.material = green;
      }
    }
  } else {
    const textured = (name: string, draw: (context: CanvasRenderingContext2D) => void) => {
      const material = new StandardMaterial(name, scene);
      material.specularColor = Color3.Black();
      const texture = new DynamicTexture(`${name}-grain`, { width: 256, height: 256 }, scene, true);
      draw(texture.getContext() as CanvasRenderingContext2D);
      texture.update(false);
      material.diffuseTexture = texture;
      owned.push(material);
      return material;
    };
    const bark = textured('resource-bark', (context) => {
      context.fillStyle = '#5a4030';
      context.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 90; i++) {
        const x = (i * 73) % 256;
        context.strokeStyle = i % 3 ? '#75533b' : '#33291f';
        context.lineWidth = 1 + (i % 3);
        context.beginPath();
        context.moveTo(x, 0);
        context.lineTo(x + Math.sin(i) * 5, 128);
        context.lineTo(x, 256);
        context.stroke();
      }
    });
    const ends = textured('resource-end-grain', (context) => {
      context.fillStyle = '#c6a16b';
      context.fillRect(0, 0, 256, 256);
      context.strokeStyle = '#97723f';
      context.lineWidth = 2;
      for (let radius = 12; radius < 145; radius += 11) {
        context.beginPath();
        context.ellipse(124, 131, radius, radius * 0.93, 0.2, 0, 2 * Math.PI);
        context.stroke();
      }
      context.strokeStyle = '#765132';
      context.beginPath();
      context.moveTo(124, 131);
      context.lineTo(215, 212);
      context.stroke();
    });
    const rough = code === 'wood';
    for (let i = 0; i < 3; i++) {
      const log = new Mesh(`resource-log-${i}`, scene);
      log.parent = root;
      const diameter = rough ? 0.48 - i * 0.035 : 0.48;
      const length = rough ? 2.65 - i * 0.29 : 1.8;
      log.position.set(i < 2 ? (i - 0.5) * 0.56 : 0, diameter / 2 + (i === 2 ? 0.43 : 0), rough ? (i - 1) * 0.12 : 0);
      log.rotation.y = rough ? (i - 1) * 0.12 : 0;
      const shell = MeshBuilder.CreateCylinder(
        `resource-log-shell-${i}`,
        {
          height: length,
          diameterBottom: diameter,
          diameterTop: diameter * (rough ? 0.77 : 1),
          tessellation: 12,
          cap: Mesh.NO_CAP,
        },
        scene,
      );
      shell.rotation.x = Math.PI / 2;
      shell.parent = log;
      shell.material = bark;
      for (const sign of [-1, 1]) {
        const end = MeshBuilder.CreateDisc(
          `resource-log-end-${i}-${sign}`,
          { radius: (diameter / 2) * (rough && sign === 1 ? 0.77 : 1), tessellation: 24 },
          scene,
        );
        end.position.z = (sign * length) / 2;
        end.rotation.y = sign === 1 ? Math.PI : 0;
        end.parent = log;
        end.material = ends;
      }
      if (rough) {
        for (const side of [-1, 1]) {
          const branch = MeshBuilder.CreateCylinder(
            `raw-wood-branch-${i}-${side}`,
            {
              height: 0.46,
              diameterBottom: 0.15,
              diameterTop: 0.09,
              tessellation: 8,
            },
            scene,
          );
          branch.position.set(side * 0.22, 0.18, side * 0.45);
          branch.rotation.z = -side * 0.85;
          branch.parent = log;
          branch.material = bark;
        }
      }
    }
  }
  // Rest the full composition on the workshop ground, including rotated pieces.
  root.computeWorldMatrix(true);
  for (const child of root.getChildMeshes()) child.computeWorldMatrix(true);
  root.position.y -= root.getHierarchyBoundingVectors(true).min.y;
  root.isPickable = false;
  for (const child of root.getChildMeshes()) child.isPickable = false;
  return root;
}
