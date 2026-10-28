import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase';
import type { MaterialDefines } from '@babylonjs/core/Materials/materialDefines';
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer';

/** Wood tool mode: harvest (« Onde ») or clearing (« Satellites »). Stone and gardens always harvest. */
export type HarvestMode = 'cut' | 'clear';

/**
 * The two markers chosen on the « Cercles de récolte » test board (proposals 5
 * and 8, SPEC-GRAMMAIRE-GESTUELLE §4). Lengths are fractions of the marker's
 * half-size, the board's 256 px canvas drawn around its centre (128 px = 1).
 */
export const HALO_MARKER = {
  /** Length of a validation, in milliseconds. */
  flashMs: 1800,
  /** Reference ring (the board's R = 84 px): the halo radius given by the scene. */
  ring: 84 / 128,
  /** Resting opacity; the validated light pushes it to 1. */
  base: 0.92,
  /** The light rises over the first 8 % and falls from 55 % to the end. */
  rise: 0.08,
  fallFrom: 0.55,
  onde: {
    /** The soft ring sits a little inside the reference ring. */
    inset: 8 / 128,
    width: 9 / 128,
    /** How far towards white the ring goes while lit. */
    whiten: 0.6,
    /** Two white waves start at 0 and 22 % and each lasts 60 % of the validation. */
    waves: [0, 0.22] as const,
    span: 0.6,
    /** Each wave widens by 40 px (≈ +48 % of the reference radius), thinning from 12 to 2 px. */
    growth: 40 / 128,
    startWidth: 12 / 128,
    endWidth: 2 / 128,
  },
  satellites: {
    width: 6 / 128,
    ringAlpha: 0.8,
    /** Orbit speed of the three resting points, radians per second. */
    orbit: 1.3,
    /** The dive completes at 1 / 1.8 of the validation, with four extra radians of spiral. */
    dive: 1.8,
    spin: 4,
    dot: 11 / 128,
    dotGlow: 6 / 128,
    /** A white burst grows from 20 to 90 px between 50 % and 90 %, and fades. */
    burstFrom: 0.5,
    burstSpan: 0.4,
    burstStart: 20 / 128,
    burstGrowth: 70 / 128,
    burstAlpha: 0.9,
  },
  /** Clearing tint (the board's red). */
  clearColour: '#ff5a4a',
} as const;

/** Half-size of the marker quad for a reference ring radius: room for the outer wave. */
export const haloHalfSize = (ringRadius: number): number => ringRadius / HALO_MARKER.ring;

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const ease = (x: number) => 1 - Math.pow(1 - clamp01(x), 3);

export type HaloFlash = {
  /** Validation animation running. */
  active: boolean;
  /** Progress through the validation, 0 to 1. */
  p: number;
  /** Whiteness and glow, 0 to 1. */
  light: number;
  /** Ring opacity before the instance's own fade. */
  base: number;
  /**
   * Factor on the resting shapes while validated. The board keeps a calmer
   * ring on a queued tree; the game shows nothing once queued, so the resting
   * shapes go out with the light instead of vanishing at the end.
   */
  keep: number;
  /** Validation over: nothing is drawn. */
  done: boolean;
};

/** Model of the shader's timing (the board's `flashState`), `age` ms after validation, `null` at rest. */
export function haloFlash(age: number | null): HaloFlash {
  if (age === null) return { active: false, p: 0, light: 0, base: HALO_MARKER.base, keep: 1, done: false };
  const p = Math.max(0, age) / HALO_MARKER.flashMs;
  if (p >= 1) return { active: false, p: 1, light: 0, base: HALO_MARKER.base, keep: 0, done: true };
  const fall = p < HALO_MARKER.fallFrom ? 1 : 1 - ease((p - HALO_MARKER.fallFrom) / (1 - HALO_MARKER.fallFrom));
  const light = ease(p / HALO_MARKER.rise) * fall;
  return { active: true, p, light, base: HALO_MARKER.base + (1 - HALO_MARKER.base) * light, keep: fall, done: false };
}

export type HaloStroke = { radius: number; width: number; alpha: number };

/** The two expanding waves of « Onde » at progress `p` (absent at rest, before their start and after their end). */
export function ondeWaves(p: number): HaloStroke[] {
  const { onde, ring } = HALO_MARKER;
  return onde.waves.flatMap((delay) => {
    const q = (p - delay) / onde.span;
    if (q <= 0 || q >= 1) return [];
    return [
      {
        radius: ring - onde.inset + q * onde.growth,
        width: onde.endWidth + (onde.startWidth - onde.endWidth) * (1 - q),
        alpha: 1 - q,
      },
    ];
  });
}

export type SatelliteFrame = {
  dive: number;
  dots: { x: number; y: number; radius: number; alpha: number }[];
  burst: HaloStroke | null;
};

/** The three points of « Satellites » `seconds` into the scene clock, at validation progress `flash`. */
export function satellites(flash: HaloFlash, seconds: number): SatelliteFrame {
  const s = HALO_MARKER.satellites;
  if (flash.done) return { dive: 0, dots: [], burst: null };
  const dive = flash.active ? ease(flash.p * s.dive) : 0;
  const dots = [0, 1, 2].map((k) => {
    const a = seconds * s.orbit + (k * 2 * Math.PI) / 3 + dive * s.spin,
      r = HALO_MARKER.ring * (1 - dive);
    return {
      x: Math.cos(a) * r,
      y: Math.sin(a) * r,
      radius: s.dot + s.dotGlow * flash.light,
      alpha: Math.min(1, flash.base + flash.light) * flash.keep,
    };
  });
  let burst: HaloStroke | null = null;
  if (flash.active && flash.p > s.burstFrom) {
    const q = clamp01((flash.p - s.burstFrom) / s.burstSpan);
    burst = { radius: s.burstStart + q * s.burstGrowth, width: 0, alpha: (1 - q) * s.burstAlpha };
  }
  return { dive, dots, burst };
}

const f = (x: number) => x.toFixed(6);
const M = HALO_MARKER,
  O = M.onde,
  S = M.satellites;

/** Fragment: the board's canvas drawing, evaluated per pixel (straight colour composited with « over »). */
const FRAGMENT_DEFINITIONS = `
varying vec2 haloLocal;
#ifdef HALO_INSTANCED
varying vec4 vHaloState;
varying vec4 vHaloTint;
#endif
float haloEase(float x) { float y = 1. - clamp(x, 0., 1.); return 1. - y * y * y; }
float haloBand(float d, float width, float aa) { return 1. - smoothstep(-aa, aa, abs(d) - width * .5); }
float haloDisc(float d, float radius, float aa) { return 1. - smoothstep(radius - aa, radius + aa, d); }
vec4 haloOver(vec4 acc, vec3 c, float a) { a = clamp(a, 0., 1.); return vec4(c * a, a) + acc * (1. - a); }
`;
const FRAGMENT_MARKER = `
{
#ifdef HALO_INSTANCED
  vec4 haloS = vHaloState;
  vec4 haloT = vHaloTint;
#else
  vec4 haloS = haloMeshState;
  vec4 haloT = haloMeshTint;
#endif
  float haloR = length(haloLocal);
#ifdef WEBGL2
  float haloAA = max(fwidth(haloR), ${f(1 / 128)});
#else
  float haloAA = ${f(1 / 128)};
#endif
  float haloNow = haloClock.x;
  float haloRaw = haloS.y > .5 ? (haloNow - haloS.x) / ${f(M.flashMs / 1000)} : 0.;
  float haloActive = haloS.y > .5 && haloRaw < 1. ? 1. : 0.;
  float haloDone = haloS.y > .5 && haloRaw >= 1. ? 1. : 0.;
  float haloP = clamp(haloRaw, 0., 1.);
  float haloFall = haloP < ${f(M.fallFrom)} ? 1. : 1. - haloEase((haloP - ${f(M.fallFrom)}) / ${f(1 - M.fallFrom)});
  float haloLight = haloActive * haloEase(haloP / ${f(M.rise)}) * haloFall;
  float haloBase = ${f(M.base)} + ${f(1 - M.base)} * haloLight;
  float haloKeep = haloActive > .5 ? haloFall : 1.;
  vec4 haloAcc = vec4(0.);
  if (haloS.z < .5) {
    float haloR0 = ${f(M.ring - O.inset)};
    haloAcc = haloOver(haloAcc, mix(haloT.rgb, vec3(1.), haloLight * ${f(O.whiten)}),
      haloBase * haloKeep * haloBand(haloR - haloR0, ${f(O.width)}, haloAA));
    for (int k = 0; k < 2; k++) {
      float q = (haloP - (k == 0 ? ${f(O.waves[0])} : ${f(O.waves[1])})) / ${f(O.span)};
      if (haloActive > .5 && q > 0. && q < 1.)
        haloAcc = haloOver(haloAcc, vec3(1.), (1. - q) * haloBand(haloR - haloR0 - q * ${f(O.growth)},
          ${f(O.endWidth)} + ${f(O.startWidth - O.endWidth)} * (1. - q), haloAA));
    }
  } else {
    vec3 haloC = mix(haloT.rgb, vec3(1.), haloLight);
    haloAcc = haloOver(haloAcc, haloC, ${f(S.ringAlpha)} * haloBase * haloKeep * haloBand(haloR - ${f(M.ring)}, ${f(S.width)}, haloAA));
    float haloDive = haloActive * haloEase(haloP * ${f(S.dive)});
    float haloDot = ${f(S.dot)} + ${f(S.dotGlow)} * haloLight;
    for (int k = 0; k < 3; k++) {
      float a = haloNow * ${f(S.orbit)} + float(k) * 2.0943951 + haloDive * ${f(S.spin)};
      vec2 at = vec2(cos(a), sin(a)) * ${f(M.ring)} * (1. - haloDive);
      haloAcc = haloOver(haloAcc, mix(haloC, vec3(1.), haloDive),
        min(1., haloBase + haloLight) * haloKeep * haloDisc(length(haloLocal - at), haloDot, haloAA));
    }
    if (haloActive > .5 && haloP > ${f(S.burstFrom)}) {
      float q = clamp((haloP - ${f(S.burstFrom)}) / ${f(S.burstSpan)}, 0., 1.);
      haloAcc = haloOver(haloAcc, vec3(1.), (1. - q) * ${f(S.burstAlpha)} * haloDisc(haloR, ${f(S.burstStart)} + q * ${f(S.burstGrowth)}, haloAA));
    }
  }
  haloAcc *= 1. - haloDone;
  color = vec4(haloAcc.a > 0. ? haloAcc.rgb / haloAcc.a : vec3(0.), haloAcc.a * haloT.a * haloClock.y);
  haloAdditive = haloActive;
}
`;

/** What a marker material reads each frame. */
export interface HaloMarkerSource {
  /** Scene clock, seconds. */
  clock(): number;
  /** Opacity shared by every instance (zoom); 1 when the mesh visibility carries it. */
  opacity(): number;
  /** Mesh-local xz to marker units (1 / half-size); 1 for a unit quad scaled per instance. */
  readonly scale: number;
  /** Non-instanced markers: validation time (s) or null, and mode. Instanced ones read their attributes. */
  state?(): { validatedAt: number | null; mode: HarvestMode };
}

/**
 * StandardMaterial plugin drawing « Onde » / « Satellites » analytically, so a
 * validation animates with a clock uniform: no texture, mesh or buffer is
 * rewritten per frame. Resting shapes blend normally; a running validation
 * adds light, like the board's additive halo (premultiplied output, alpha 0).
 * Instanced markers carry `haloState` (validatedAt s, validated, mode, 0) and
 * `haloTint` (rgb, opacity) per thin instance; others use the material's
 * emissive colour and `source.state()`.
 */
export class HaloMarkerPlugin extends MaterialPluginBase {
  static readonly attributes = ['haloState', 'haloTint'] as const;
  constructor(
    material: StandardMaterial,
    private readonly source: HaloMarkerSource,
    readonly instanced: boolean,
  ) {
    super(material, 'HaloMarker', 220, { HALO_MARKER: true, HALO_INSTANCED: instanced }, true, false);
    this.registerForExtraEvents = true;
    this._enable(true);
  }
  override getClassName(): string {
    return 'HaloMarkerPlugin';
  }
  override prepareDefines(defines: MaterialDefines): void {
    defines['HALO_MARKER'] = true;
    defines['HALO_INSTANCED'] = this.instanced;
  }
  override getAttributes(attributes: string[]): void {
    if (this.instanced) attributes.push(...HaloMarkerPlugin.attributes);
  }
  override getUniforms() {
    return {
      ubo: [
        { name: 'haloClock', size: 4, type: 'vec4' },
        { name: 'haloShape', size: 4, type: 'vec4' },
        { name: 'haloMeshState', size: 4, type: 'vec4' },
        { name: 'haloMeshTint', size: 4, type: 'vec4' },
      ],
      vertex: 'uniform vec4 haloShape;',
      fragment: 'uniform vec4 haloClock; uniform vec4 haloMeshState; uniform vec4 haloMeshTint;',
    };
  }
  /** The uniform values bound for the next frame (also for tests). */
  uniforms(): {
    clock: [number, number];
    scale: number;
    state: [number, number, number];
    tint: [number, number, number];
  } {
    const state = this.source.state?.() ?? { validatedAt: null, mode: 'cut' as HarvestMode },
      tint = (this._material as StandardMaterial).emissiveColor;
    return {
      clock: [this.source.clock(), this.source.opacity()],
      scale: this.source.scale,
      state: [state.validatedAt ?? 0, state.validatedAt === null ? 0 : 1, state.mode === 'clear' ? 1 : 0],
      tint: [tint.r, tint.g, tint.b],
    };
  }
  override hardBindForSubMesh(buffer: UniformBuffer): void {
    const u = this.uniforms();
    buffer.updateFloat4('haloClock', u.clock[0], u.clock[1], 0, 0);
    buffer.updateFloat4('haloShape', u.scale, 0, 0, 0);
    buffer.updateFloat4('haloMeshState', u.state[0], u.state[1], u.state[2], 0);
    buffer.updateFloat4('haloMeshTint', u.tint[0], u.tint[1], u.tint[2], 1);
  }
  override getCustomCode(type: string) {
    if (type === 'vertex')
      return {
        CUSTOM_VERTEX_DEFINITIONS: `
varying vec2 haloLocal;
#ifdef HALO_INSTANCED
attribute vec4 haloState;
attribute vec4 haloTint;
varying vec4 vHaloState;
varying vec4 vHaloTint;
#endif
`,
        CUSTOM_VERTEX_MAIN_END: `
haloLocal = position.xz * haloShape.x;
#ifdef HALO_INSTANCED
vHaloState = haloState;
vHaloTint = haloTint;
#endif
`,
      };
    if (type !== 'fragment') return null;
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: FRAGMENT_DEFINITIONS,
      CUSTOM_FRAGMENT_MAIN_BEGIN: 'float haloAdditive = 0.;',
      CUSTOM_FRAGMENT_BEFORE_FOG: FRAGMENT_MARKER,
      // PREMULTIPLYALPHA has multiplied the colour; a validation adds its light.
      CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: 'color.a *= 1. - haloAdditive;',
    };
  }
}
