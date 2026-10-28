import { Constants } from '@babylonjs/core/Engines/constants';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { FresnelParameters } from '@babylonjs/core/Materials/fresnelParameters';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Material } from '@babylonjs/core/Materials/material';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import type { PointLight } from '@babylonjs/core/Lights/pointLight';
import type { Scene } from '@babylonjs/core/scene';
import { clusteredEffectLight, releaseClusteredEffectLight } from './village-braziers';

type Rgb = readonly [number, number, number];

/**
 * Every tunable of the market beacon (proposal 10 of the marker board, kept for
 * market deliveries). Scene units: a cell is 2.5, the market hall about 5 × 2.5
 * and 4 high. Times in milliseconds.
 */
export const MARKET_BEACON = {
  /** Envelope: a quick rise, a hold, then a soft fade (≈ 1.9 s for one delivery). */
  riseMs: 240,
  // Tuned by Tristan on bench/marche.html (28 October).
  holdMs: 1060,
  fallMs: 800,
  /** Grouped deliveries hold the same column longer instead of stacking columns. */
  extraHoldMs: 450,
  maxExtraHolds: 4,
  colours: {
    gold: [1, 0.7, 0.3] as Rgb,
    white: [1, 0.95, 0.82] as Rgb,
  },
  column: {
    height: 13,
    radius: 1.45,
    coreRadius: 0.38,
    tessellation: 28,
    /** Brightness of the gold shell and of the white core at their foot (above 1 saturates towards white). */
    shell: 1.5,
    core: 1.6,
    /** How fast each fades upwards: brightness × (1 − height)^falloff. */
    shellFalloff: 0.85,
    coreFalloff: 1.3,
    /** Edge softness (emissive Fresnel power): higher is a narrower, softer glow. */
    softness: 1.3,
    /** The column shoots up from 30 % to its full height. */
    growMs: 520,
    shimmer: 0.06,
  },
  /** Vertical sparks rising fast inside the column. */
  sparks: {
    count: 18,
    size: 0.13,
    height: 9,
    radius: [0.2, 0.95] as const,
    speed: [5, 9] as const,
    /** Brightness multiplier (above 1 saturates towards white). */
    glow: 2,
  },
  /** Motes circling up the column on helices. */
  motes: {
    count: 30,
    size: 0.32,
    height: 11,
    radius: [2.5, 3.4] as const,
    /** Each helix widens or narrows by up to this fraction on the way up. */
    flare: [-0.3, 0.35] as const,
    speed: [2.6, 4.2] as const,
    /** Angular speed, radians per second. */
    spin: [1.6, 2.8] as const,
    /** Share of the motes tinted white rather than gold. */
    white: 0.35,
    glow: 1.8,
  },
  /** A real light, drawn by the village fire cluster: visible at night only. */
  light: {
    colour: [1, 0.6, 0.26] as Rgb,
    intensity: 1.5,
    range: 13.5,
    height: 1.4,
  },
} as const;

export interface BeaconTiming {
  /** Start of the rise; moved back when a new delivery revives a fading column. */
  riseFrom: number;
  holdUntil: number;
}
const easeOut = (t: number) => 1 - (1 - t) * (1 - t);
const smooth = (t: number) => t * t * (3 - 2 * t);

/** Brightness 0..1 of the beacon at `now`, or null once it is over. */
export function beaconLevel(timing: BeaconTiming, now: number): number | null {
  const { riseMs, fallMs } = MARKET_BEACON;
  if (now < timing.holdUntil) return easeOut(Math.min(1, Math.max(0, (now - timing.riseFrom) / riseMs)));
  const fall = (now - timing.holdUntil) / fallMs;
  return fall >= 1 ? null : 1 - smooth(fall);
}

/** One delivery starts a column; more, even while it fades, prolong the same one. */
export function extendBeacon(timing: BeaconTiming | null, now: number, deliveries: number): BeaconTiming {
  const { riseMs, holdMs, extraHoldMs, maxExtraHolds } = MARKET_BEACON;
  const hold = riseMs + holdMs + Math.min(Math.max(0, deliveries - 1), maxExtraHolds) * extraHoldMs;
  const level = timing ? beaconLevel(timing, now) : null;
  if (!timing || level === null) return { riseFrom: now, holdUntil: now + hold };
  // Resume the rise from the current brightness, without a jump.
  const riseFrom = level >= 1 ? timing.riseFrom : now - riseMs * (1 - Math.sqrt(1 - level));
  return { riseFrom, holdUntil: Math.max(timing.holdUntil, now + hold) };
}

/** Deterministic per-particle variety. */
const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
const lerp = (range: readonly [number, number], t: number) => range[0] + (range[1] - range[0]) * t;

interface Particle {
  spark: boolean;
  delay: number;
  speed: number;
  height: number;
  radius: number;
  flare: number;
  phase: number;
  spin: number;
  size: number;
  colour: Rgb;
  glow: number;
}

/**
 * Light column above the town hall when a market transaction credits the
 * village. Everything is created once: a column mesh, one thin-instanced
 * particle mesh (sparks and helix motes) and a clustered point light at zero.
 * A delivery only enables the two meshes and moves numbers; at rest `update`
 * returns at once.
 */
export class MarketBeacon {
  readonly column: Mesh;
  readonly particles: Mesh;
  readonly light: PointLight | null;
  readonly #columnMaterial: StandardMaterial;
  readonly #particleMaterial: StandardMaterial;
  readonly #matrices: Float32Array;
  readonly #colours: Float32Array;
  readonly #particles: Particle[];
  #timing: BeaconTiming | null = null;
  #bornAt = 0;

  constructor(private readonly scene: Scene) {
    const { column, sparks, motes, colours } = MARKET_BEACON;
    this.#columnMaterial = beaconMaterial('market-beacon-column', scene);
    this.#particleMaterial = beaconMaterial('market-beacon-particle', scene);
    this.#particleMaterial.emissiveColor.set(1, 1, 1);

    const shell = beamShell(
        'market-beacon-shell',
        column.radius,
        colours.gold,
        column.shell,
        column.shellFalloff,
        scene,
      ),
      core = beamShell('market-beacon-core', column.coreRadius, colours.white, column.core, column.coreFalloff, scene);
    this.column = Mesh.MergeMeshes([shell, core], true, true)!;
    this.column.name = 'market-beacon-column';
    this.column.material = this.#columnMaterial;
    prepare(this.column, false, true);

    this.#particles = [
      ...Array.from({ length: sparks.count }, (_, i) => ({
        spark: true,
        delay: hash(i) * 0.35,
        speed: lerp(sparks.speed, hash(i + 40)),
        height: sparks.height,
        radius: lerp(sparks.radius, hash(i + 80)),
        flare: 0,
        phase: i * 2.4,
        spin: 0.8,
        size: sparks.size * (0.7 + 0.6 * hash(i + 120)),
        colour: colours.white,
        glow: sparks.glow,
      })),
      ...Array.from({ length: motes.count }, (_, i) => ({
        spark: false,
        delay: hash(i + 200) * 0.6,
        speed: lerp(motes.speed, hash(i + 240)),
        height: motes.height,
        radius: lerp(motes.radius, hash(i + 280)),
        flare: lerp(motes.flare, hash(i + 320)),
        phase: (i / motes.count) * Math.PI * 2 + hash(i + 360),
        spin: lerp(motes.spin, hash(i + 400)),
        size: motes.size * (0.6 + 0.8 * hash(i + 440)),
        colour: hash(i + 480) < motes.white ? colours.white : colours.gold,
        glow: motes.glow,
      })),
    ];
    this.particles = MeshBuilder.CreateIcoSphere('market-beacon-particles', { radius: 0.5, subdivisions: 2 }, scene);
    this.particles.material = this.#particleMaterial;
    const count = this.#particles.length;
    this.#matrices = new Float32Array(count * 16);
    this.#colours = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) this.#matrices[i * 16 + 15] = 1;
    this.particles.thinInstanceSetBuffer('matrix', this.#matrices, 16, false);
    this.particles.thinInstanceSetBuffer('color', this.#colours, 4, false);
    // Instances roam the whole column: skip culling against the source sphere.
    this.particles.alwaysSelectAsActiveMesh = true;
    prepare(this.particles, true);

    this.light = clusteredEffectLight(scene, this, 'market-beacon-light', MARKET_BEACON.light.range);
    if (this.light) this.light.diffuse.set(...MARKET_BEACON.light.colour);
  }

  get active(): boolean {
    return this.#timing !== null;
  }
  get instanceCount(): number {
    return this.#particles.length;
  }

  /** Start, or prolong, the column. No mesh, material or light is created here. */
  trigger(now: number, deliveries = 1): void {
    if (deliveries < 1) return;
    if (!this.#timing) this.#bornAt = now;
    this.#timing = extendBeacon(this.#timing, now, deliveries);
  }

  /** Per frame, at the hall's foot in scene units. Free at rest. */
  update(now: number, x: number, y: number, z: number, visible = true): void {
    if (!this.#timing) return;
    const level = beaconLevel(this.#timing, now);
    if (level === null || !visible) {
      if (level === null) this.#timing = null;
      this.#hide();
      return;
    }
    const { column, light } = MARKET_BEACON;
    const age = now - this.#bornAt;
    if (!this.column.isEnabled()) this.column.setEnabled(true);
    if (!this.particles.isEnabled()) this.particles.setEnabled(true);
    this.column.position.set(x, y, z);
    this.column.scaling.y = 0.3 + 0.7 * easeOut(Math.min(1, age / column.growMs));
    const glow = level * (1 + column.shimmer * Math.sin(age * 0.011));
    this.#columnMaterial.emissiveColor.set(glow, glow, glow);
    this.particles.position.set(x, y, z);
    this.#writeParticles(age / 1000, level);
    if (this.light) {
      this.light.position.set(x, y + light.height, z);
      this.light.intensity = light.intensity * level;
    }
  }

  #writeParticles(seconds: number, level: number): void {
    const matrices = this.#matrices,
      colours = this.#colours;
    for (let i = 0; i < this.#particles.length; i++) {
      const p = this.#particles[i]!,
        m = i * 16,
        c = i * 4;
      // Born at the foot one after another, then looping up the column.
      const travel = (seconds - p.delay) * p.speed;
      let u = travel < 0 ? -1 : (travel / p.height) % 1;
      const radius = p.radius * (1 + p.flare * u),
        angle = p.phase + seconds * p.spin + (p.spark ? 0 : u * 1.4);
      // Fade in at the foot, out towards the top.
      const fade = u < 0 ? 0 : Math.min(1, u / 0.08) * Math.pow(1 - u, p.spark ? 1.6 : 1.1);
      if (u < 0) u = 0;
      const size = fade > 0 ? p.size * (1 - 0.45 * u) : 0;
      matrices[m] = matrices[m + 5] = matrices[m + 10] = size;
      matrices[m + 12] = Math.cos(angle) * radius;
      matrices[m + 13] = 0.2 + u * p.height;
      matrices[m + 14] = Math.sin(angle) * radius;
      const brightness = fade * level * p.glow;
      colours[c] = p.colour[0] * brightness;
      colours[c + 1] = p.colour[1] * brightness;
      colours[c + 2] = p.colour[2] * brightness;
      colours[c + 3] = 1;
    }
    this.particles.thinInstanceBufferUpdated('matrix');
    this.particles.thinInstanceBufferUpdated('color');
  }

  #hide(): void {
    if (this.column.isEnabled()) this.column.setEnabled(false);
    if (this.particles.isEnabled()) this.particles.setEnabled(false);
    if (this.light) this.light.intensity = 0;
  }

  dispose(): void {
    if (this.light) releaseClusteredEffectLight(this.scene, this, this.light);
    this.column.dispose(false, false);
    this.particles.dispose(false, false);
    this.#columnMaterial.dispose();
    this.#particleMaterial.dispose();
  }
}

/** Additive, unlit, soft at the silhouette (emissive Fresnel): a glow, not a tube. */
function beaconMaterial(name: string, scene: Scene): StandardMaterial {
  const material = new StandardMaterial(name, scene);
  material.disableLighting = true;
  material.diffuseColor = Color3.Black();
  material.specularColor = Color3.Black();
  material.emissiveColor = Color3.Black();
  material.emissiveFresnelParameters = new FresnelParameters({
    leftColor: Color3.Black(),
    rightColor: Color3.White(),
    bias: 0,
    power: MARKET_BEACON.column.softness,
  });
  material.alphaMode = Constants.ALPHA_ADD;
  material.transparencyMode = Material.MATERIAL_ALPHABLEND;
  material.disableDepthWrite = true;
  material.fogEnabled = false;
  return material;
}

/** Open cylinder standing on y = 0, brightest at the foot and fading upwards. */
function beamShell(name: string, radius: number, colour: Rgb, base: number, falloff: number, scene: Scene): Mesh {
  const { height, tessellation } = MARKET_BEACON.column;
  const mesh = MeshBuilder.CreateCylinder(
    name,
    { height, diameter: radius * 2, tessellation, cap: Mesh.NO_CAP, subdivisions: 6 },
    scene,
  );
  const positions = mesh.getVerticesData(VertexBuffer.PositionKind)!;
  const colours: number[] = [];
  for (let v = 0; v < positions.length; v += 3) {
    positions[v + 1]! += height / 2;
    const t = positions[v + 1]! / height,
      glow = base * Math.pow(1 - t, falloff);
    colours.push(colour[0] * glow, colour[1] * glow, colour[2] * glow, 1);
  }
  mesh.setVerticesData(VertexBuffer.PositionKind, positions);
  mesh.setVerticesData(VertexBuffer.ColorKind, colours);
  mesh.refreshBoundingInfo();
  return mesh;
}

/**
 * Compile now every shader variant the effect will draw with: the first
 * delivery must not stall on a compilation (measured: 130 and 470 ms frames).
 * Thin instances need the instanced variant; the growing column is drawn
 * stretched (non-uniform scaling), then at its full height.
 */
function prepare(mesh: Mesh, instanced = false, stretched = false): void {
  mesh.isPickable = false;
  mesh.receiveShadows = false;
  mesh.setEnabled(false);
  const material = mesh.material;
  if (!material) return;
  const options = { useInstances: instanced };
  if (!stretched) {
    material.forceCompilation(mesh, undefined, options);
    return;
  }
  mesh.scaling.y = 0.5;
  mesh.computeWorldMatrix(true);
  material.forceCompilation(
    mesh,
    () => {
      mesh.scaling.y = 1;
      mesh.computeWorldMatrix(true);
      material.forceCompilation(mesh, undefined, options);
    },
    options,
  );
}
