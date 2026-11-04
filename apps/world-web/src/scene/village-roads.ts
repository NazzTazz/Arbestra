import {
  automaticRoadStrokes,
  emptyInfrastructure,
  type TravelCell,
  type TravelRoute,
  type InfrastructurePlan,
} from '@arbestra/contracts';
import type { Scene } from '@babylonjs/core/scene';
import type { WorldSpace } from './world-space';
import { InfrastructureRenderer } from './infrastructure-renderer';
export { roadEdges } from './road-profile';

/** Automatic decoration shares the manual road masonry and sidewalk renderer. */
export class VillageRoads {
  readonly #renderer: InfrastructureRenderer;
  #routeSignature = '';
  #routes: readonly TravelRoute[] | null = null;
  #stubs: readonly TravelRoute[] = [];
  #requestSignature = '';
  #revision = 0;
  #plan: InfrastructurePlan = emptyInfrastructure();
  #alpha = 1;
  constructor(scene: Scene) {
    this.#renderer = new InfrastructureRenderer(scene, true);
  }
  update(
    signature: string,
    routes: readonly TravelRoute[],
    space: WorldSpace,
    ground: (cell: TravelCell) => { code: number; height: number } | null,
    followTerrain = false,
    groundIdentity?: string,
    groundCellIdentity?: (x: number, y: number) => string | number,
    /** Tronçons `[case automatique, case de route]` : le bras de la route automatique vers une case de route voisine. */
    stubs: readonly TravelRoute[] = [],
  ): void {
    const requestSignature = JSON.stringify([signature, groundIdentity]);
    if (requestSignature === this.#requestSignature && routes === this.#routes && stubs === this.#stubs) return;
    this.#requestSignature = requestSignature;
    // Streamed ground does not change the routes: serialize them only when the
    // caller hands over another route list.
    const routeSignature =
      routes === this.#routes && stubs === this.#stubs
        ? this.#routeSignature
        : JSON.stringify([space.width, space.height, routes.map((r) => r.cells), stubs.map((r) => r.cells)]);
    this.#routes = routes;
    this.#stubs = stubs;
    if (routeSignature !== this.#routeSignature) {
      this.#routeSignature = routeSignature;
      this.#plan = {
        ...emptyInfrastructure(),
        roads: automaticRoadStrokes(
          [...routes, ...stubs],
          { widthCells: space.width, heightCells: space.height },
          // Le bout masqué d'un tronçon n'a pas de nœud : la case de route dessine le sien.
          stubs.length
            ? new Set(
                [...routes, ...stubs.map((r) => ({ cells: [r.cells[0]!] }))].flatMap((r) =>
                  r.cells.map((c) => c.cellX + ':' + c.cellY),
                ),
              )
            : undefined,
        ),
      };
    }
    this.#renderer.update(
      this.#plan,
      space,
      (x, y) => {
        const g = ground({ cellX: x, cellY: y });
        return g?.code === 1 ? g.height : null;
      },
      false,
      ++this.#revision,
      undefined,
      false,
      [],
      { followTerrain, groundIdentity, ...(groundCellIdentity ? { groundCellIdentity } : {}) },
    );
    for (const mesh of this.#renderer.meshes)
      mesh.name = mesh.material?.name === 'infrastructure-border' ? 'village-road-curbs' : 'village-road-paved';
    this.show(this.#alpha);
  }
  show(alpha: number): void {
    this.#alpha = alpha;
    for (const mesh of this.#renderer.meshes) {
      mesh.visibility = alpha;
      mesh.setEnabled(alpha > 0);
    }
  }
  dispose(): void {
    this.#renderer.dispose();
  }
}
