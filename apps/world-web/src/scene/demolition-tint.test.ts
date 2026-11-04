import { expect, it } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { demolitionTintedMaterial } from './demolition-tint';

it('tints a material without copying its textures (the « Détruire » icon waited on a copied grain)', () => {
  const engine = new NullEngine(),
    scene = new Scene(engine);
  try {
    const original = new StandardMaterial('stone', scene);
    original.diffuseColor = new Color3(0.8, 0.8, 0.8);
    original.diffuseTexture = new Texture('grain.png', scene);
    original.bumpTexture = new Texture('bump.png', scene);
    const textures = scene.textures.length;
    const red = demolitionTintedMaterial(original, 0.6);
    expect(red.diffuseTexture).toBe(original.diffuseTexture);
    expect(red.bumpTexture).toBe(original.bumpTexture);
    // The clone's copies are disposed: no texture left behind per tinted material.
    expect(scene.textures.length).toBe(textures);
    expect(red.diffuseColor.r).toBeLessThan(original.diffuseColor.r + 1e-9);
    expect(red.emissiveColor.r).toBeGreaterThan(0);
  } finally {
    scene.dispose();
    engine.dispose();
  }
});
