/**
 * Banc voirie (développement, hors build) : routes charretières dans les trois revêtements,
 * un virage pavé et une route actuelle pour comparaison. ?rayon=8 : distance minimale du jeu.
 */
import {
  emptyInfrastructure,
  CART_ROAD_HALF_WIDTH,
  type InfrastructurePlan,
  type RoadStroke,
} from '@arbestra/contracts';
import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { InfrastructureRenderer } from '../src/scene/infrastructure-renderer';
import { WorldSpace } from '../src/scene/world-space';

const params = new URLSearchParams(location.search);
const out = document.getElementById('etat')!;
const canvas = document.getElementById('vue') as HTMLCanvasElement;
const engine = new Engine(canvas, true, { powerPreference: 'high-performance' });
const scene = new Scene(engine);
scene.clearColor = new Color4(0.62, 0.7, 0.75, 1);
new HemisphericLight('ciel', new Vector3(0, 1, 0), scene).intensity = 0.45;
const sun = new DirectionalLight('soleil', new Vector3(-0.4, -1, 0.5), scene);
sun.intensity = 0.6;
const flat = () => 0;

let n = 0;
const road = (
  points: Array<[number, number]>,
  material: RoadStroke['material'],
  width: number,
  border: boolean,
): RoadStroke => ({
  id: 'r' + n++,
  points: points.map(([x, y]) => ({ x, y })),
  width,
  material,
  border,
  operation: 'paint',
});
/** Sous-division d'une limite de cases (axe d'une route charretière) et d'un centre de case. */
const edge = (cell: number) => cell * 8 + 4,
  centre = (cell: number) => cell * 8;

function showcase(): InfrastructurePlan {
  const plan = emptyInfrastructure();
  const rows: Array<RoadStroke['material']> = ['earth', 'rubble', 'stone-1', 'stone-2'];
  rows.forEach((material, i) =>
    plan.roads.push(
      road(
        [
          [edge(26), edge(30 + i * 3)],
          [edge(36), edge(30 + i * 3)],
        ],
        material,
        CART_ROAD_HALF_WIDTH,
        true,
      ),
    ),
  );
  // Virage à angle vif, pavé, puis une route actuelle (demi-largeur 4, terre) pour comparer.
  plan.roads.push(
    road(
      [
        [edge(38), edge(30)],
        [edge(44), edge(30)],
        [edge(44), edge(38)],
      ],
      'stone-1',
      CART_ROAD_HALF_WIDTH,
      true,
    ),
  );
  plan.roads.push(
    road(
      [
        [centre(38), centre(41)],
        [centre(46), centre(41)],
      ],
      'earth',
      4,
      false,
    ),
  );
  return plan;
}

async function show() {
  const space = new WorldSpace(64, 64, { cellX: 36, cellY: 35 });
  const ground = MeshBuilder.CreateGround('herbe', { width: 160, height: 160 }, scene);
  const grass = new StandardMaterial('herbe', scene);
  grass.diffuseColor = Color3.FromHexString('#6e8247');
  grass.specularColor = Color3.Black();
  ground.material = grass;
  ground.position.y = -0.002;
  const renderer = new InfrastructureRenderer(scene);
  const t = performance.now();
  renderer.update(showcase(), space, flat, false, 0, undefined, false, [], { groundIdentity: 'plat' });
  const ms = performance.now() - t;
  const target = space.project({ cellX: 36, cellY: 35 });
  const camera = new ArcRotateCamera('camera', -Math.PI / 2 + 0.6, 0.9, 30, new Vector3(target.x, 0, target.z), scene);
  camera.attachControl(canvas, true);
  camera.radius = Number(params.get('rayon') ?? 30);
  const vertices = renderer.meshes.reduce((s, m) => s + m.getTotalVertices(), 0);
  (window as unknown as { __voirie: unknown }).__voirie = { ms, maillages: renderer.meshes.length, sommets: vertices };
  out.textContent =
    `Rangées, du premier plan vers le fond : terre, gravats, petite pierre, grands pavés (routes charretières, 2 cases),\n` +
    `puis un virage pavé et une route actuelle (terre, 1,25 m). Construction ${ms.toFixed(0)} ms · ` +
    `${renderer.meshes.length} maillages · ${vertices.toLocaleString('fr')} sommets`;
}

show().catch((e: unknown) => {
  out.textContent = 'Erreur : ' + (e instanceof Error ? e.stack : String(e));
});
engine.runRenderLoop(() => scene.render());
