/** The scene's copies of the village cells, positioned in its local frame.
 * A cell keeps its copy while its source object (kept by the reconciled
 * state when unchanged) and the frame stay the same: caches keyed by cell
 * identity downstream (idle itineraries) then survive every publication.
 * `frame` names everything `at` depends on; another frame copies anew. */
export class ProjectedCells<C extends object> {
  #frame: string | null = null;
  #copies = new WeakMap<C, C>();
  project(cells: readonly C[], frame: string, at: (cell: C) => Partial<C>): C[] {
    if (frame !== this.#frame) {
      this.#frame = frame;
      this.#copies = new WeakMap();
    }
    return cells.map((cell) => {
      let copy = this.#copies.get(cell);
      if (!copy) {
        copy = { ...cell, ...at(cell) };
        this.#copies.set(cell, copy);
      }
      return copy;
    });
  }
}
