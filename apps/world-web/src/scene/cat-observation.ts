/** CSS pixels, so discovery does not depend on GPU resolution or device pixel ratio. */
export function recognizableCatEye(reflection: number, x: number, y: number, width: number, height: number): boolean {
  return reflection >= 0.28 && x >= 0.35 && x <= 0.65 && y >= 0.3 && y <= 0.7 && width >= 12 && height >= 16;
}
