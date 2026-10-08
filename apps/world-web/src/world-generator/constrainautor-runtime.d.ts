/** Public API used from Constrainautor 4.1.0. Its shipped implementation .ts
 * assumes looser compiler settings. Keep Arbestra's strict checks intact. */
export default class Constrainautor {
  constructor(delaunay:{coords:ArrayLike<number>;triangles:Uint32Array;halfedges:Int32Array;hull:Uint32Array}, edges?:readonly [number,number][]);
}
