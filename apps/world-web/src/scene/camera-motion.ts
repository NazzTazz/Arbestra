/** What makes the strategic camera's view: its target and its orbit. */
export interface CameraPose {
  readonly target: { readonly x: number; readonly y: number; readonly z: number };
  readonly alpha: number;
  readonly beta: number;
  readonly radius: number;
}

/**
 * Whether a view change notification is a real move of the camera. Babylon also notifies when the
 * view is recomputed with the same pose (a resize of the render target, a target vector written
 * with its own value). Counting those as motion lowered the resolution, whose resize notified
 * again, 300 ms later it rose, and so on: three or four canvas resizes a second with the camera
 * still (15 November, desire paths on). O(1), no allocation.
 */
export class CameraMotion {
  #x = NaN;
  #y = NaN;
  #z = NaN;
  #alpha = NaN;
  #beta = NaN;
  #radius = NaN;
  moved(pose: CameraPose): boolean {
    const { x, y, z } = pose.target;
    if (
      x === this.#x &&
      y === this.#y &&
      z === this.#z &&
      pose.alpha === this.#alpha &&
      pose.beta === this.#beta &&
      pose.radius === this.#radius
    )
      return false;
    this.#x = x;
    this.#y = y;
    this.#z = z;
    this.#alpha = pose.alpha;
    this.#beta = pose.beta;
    this.#radius = pose.radius;
    return true;
  }
}
