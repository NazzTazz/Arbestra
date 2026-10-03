import { ParticleSystem } from '@babylonjs/core/Particles/particleSystem';
import '@babylonjs/core/Particles/particleSystemComponent';
import '@babylonjs/core/Shaders/particles.vertex';
import '@babylonjs/core/Shaders/particles.fragment';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';

/** Bounded native emitter; droplets are presentation, never persistent world entities. */
export class LocalRain {
  readonly #system: ParticleSystem;
  readonly #center = Vector3.Zero();
  #active = false;
  constructor(scene: Scene, ground: (x: number, z: number) => number | null) {
    const rain = new ParticleSystem('local-weather-rain', 480, scene); this.#system = rain;
    const texture = new DynamicTexture('raindrop', { width: 16, height: 32 }, scene, false);
    texture.hasAlpha = true;
    const ctx = texture.getContext(), gradient = ctx.createLinearGradient(0, 0, 0, 32);
    gradient.addColorStop(0, 'rgba(200,220,235,0)'); gradient.addColorStop(.7, 'rgba(200,220,235,.75)');
    gradient.addColorStop(1, 'rgba(200,220,235,0)');
    ctx.fillStyle = gradient; ctx.fillRect(6, 0, 4, 32); texture.update();
    rain.particleTexture = texture; rain.emitter = this.#center;
    rain.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    rain.color1 = new Color4(.65, .78, .88, .5); rain.color2 = rain.color1.clone();
    rain.colorDead = new Color4(.65, .78, .88, 0);
    rain.minSize = .65; rain.maxSize = .95;
    rain.minScaleX = rain.maxScaleX = .18; rain.minScaleY = rain.maxScaleY = 1;
    rain.minLifeTime = rain.maxLifeTime = .9; rain.updateSpeed = 1 / 60;
    rain.direction1 = new Vector3(2, -20, .9); rain.direction2 = new Vector3(2, -20, .9);
    rain.minEmitPower = rain.maxEmitPower = 1;
    rain.billboardMode = ParticleSystem.BILLBOARDMODE_STRETCHED;
    rain.startPositionFunction = (_matrix, position) => {
      const x = this.#center.x + (Math.random() - .5) * 48, z = this.#center.z + (Math.random() - .5) * 48;
      const height = ground(x, z);
      position.set(x, height === null ? -100 : height + 14, z);
    };
    const advance = rain.updateFunction;
    rain.updateFunction = particles => {
      advance(particles);
      for (const particle of particles) {
        const height = ground(particle.position.x, particle.position.z);
        if (height === null || particle.position.y <= height) particle.age = particle.lifeTime;
      }
    };
  }
  update(target: Vector3, intensity: number, active: boolean): void {
    if (!active) {
      if (this.#active) { this.#system.stop(); this.#system.reset(); }
      this.#active = false; return;
    }
    if (Vector3.DistanceSquared(target, this.#center) > 24 ** 2) this.#system.reset();
    this.#center.copyFrom(target);
    this.#system.emitRate = Math.round(420 * intensity);
    if (!this.#active) this.#system.start();
    this.#active = true;
  }
  dispose(): void { this.#system.dispose(); }
}
