import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { expect, it } from 'vitest';
import { demolitionTintedMaterial } from './demolition-tint';

// The « Détruire » icon tints the catalogue's stone house with this material
// (building-presentation.ts); the house itself needs a browser canvas.
it('tints a material with the demolition red, keeping the original intact', () => {
  const engine = new NullEngine(),
    scene = new Scene(engine);
  try {
    const stone = new StandardMaterial('stone', scene);
    stone.diffuseColor = new Color3(0.6, 0.6, 0.55);
    const red = demolitionTintedMaterial(stone, 0.6);
    expect(red.name).toBe('stone-demolition');
    expect(red.diffuseColor.r).toBeCloseTo(0.6);
    expect(red.diffuseColor.g).toBeCloseTo(0.216);
    expect(red.diffuseColor.b).toBeCloseTo(0.165);
    expect(red.emissiveColor.r).toBeCloseTo(0.42);
    expect(stone.diffuseColor.g).toBeCloseTo(0.6);
    // The scene's pulse drives the glow itself: none by default.
    expect(demolitionTintedMaterial(stone).emissiveColor.r).toBe(0);
  } finally {
    scene.dispose();
    engine.dispose();
  }
});
