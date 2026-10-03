/** CSS pixels, so discovery does not depend on GPU resolution or device pixel ratio. */
export function recognizableCatEye(reflection: number, x: number, y: number, width: number, height: number): boolean {
  return reflection >= .28 && x >= .35 && x <= .65 && y >= .3 && y <= .7 && width >= 12 && height >= 16;
}
