import { PostProcess } from '@babylonjs/core/PostProcesses/postProcess';
import { PassPostProcess } from '@babylonjs/core/PostProcesses/passPostProcess';
import { ShaderStore } from '@babylonjs/core/Engines/shaderStore';
import { Constants } from '@babylonjs/core/Engines/constants';
import { RawTexture3D } from '@babylonjs/core/Materials/Textures/rawTexture3D';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import '@babylonjs/core/Rendering/depthRendererSceneComponent';
import '@babylonjs/core/Shaders/depth.vertex';
import '@babylonjs/core/Shaders/depth.fragment';
import '@babylonjs/core/Shaders/postprocess.vertex';
import '@babylonjs/core/Shaders/pass.fragment';
import type { Scene } from '@babylonjs/core/scene';
import { COSMOLOGY, TAU, cyclePhases } from './cosmology';
import { weatherAt, WEATHER_DRIFT_SECONDS } from './weather';
import type { WeatherMap } from './weather-view';

const fragment = `
precision highp float;
precision highp sampler3D;
varying vec2 vUV;
uniform sampler2D sceneDepth;
uniform sampler2D weatherField;
uniform sampler3D noiseVolume;
uniform mat4 inverseVP;
uniform vec3 eye;
uniform vec3 forward;
uniform vec3 sun;
uniform vec2 clock;
uniform vec3 wind;
uniform float ready;
const float TAU = 6.28318530718;
float tubeDistance(vec3 p) { return length(vec2(length(p.xz) - 2.4, p.y)); }
vec3 localPoint(vec3 p) {
  float c = cos(clock.y), s = sin(clock.y);
  return vec3(c*p.x+s*p.z, p.y, -s*p.x+c*p.z);
}
float density(vec3 world) {
  vec3 p = localPoint(world);
  float tube = tubeDistance(p);
  float band = smoothstep(1.015,1.11,tube) * (1.-smoothstep(1.3,1.52,tube));
  if (band < .001) return 0.;
  float u = atan(p.z,p.x), v = atan(p.y,length(p.xz)-2.4);
  // Backtrace a continuous helical wind: two tube revolutions per lap of the ring.
  // The periodic curl varies its pitch without a seam or accumulating distortion.
  float sourceU = u-wind.x;
  v = v-2.*wind.x+.35*(sin(3.*sourceU)-sin(3.*u));
  u = sourceU;
  vec2 uv = vec2(u,v-3.14159265)/TAU;
  // Weather texture already carries its own drift: undo that before applying our wind.
  float coverage = texture2D(weatherField,fract(uv+wind.yz)).r;
  vec3 q = vec3((2.4+tube*cos(v))*cos(u),tube*sin(v),(2.4+tube*cos(v))*sin(u));
  float n = texture(noiseVolume,q*.19).r * .65
    + texture(noiseVolume,q*.53 + vec3(clock.x*.025,0.,0.)).r * .25
    + texture(noiseVolume,q*1.3).r * .1;
  return band * smoothstep(.18,.8,coverage) * smoothstep(.32,.66,n) * 5.;
}
float sunlight(vec3 p, vec3 dir, float distanceToSun) {
  float t = .04, visibility = 1.;
  // Sphere tracing of the solid torus: shadow only, no cloud self-shadow loop.
  for (int j=0; j<20; j++) {
    if (t >= distanceToSun) return visibility;
    float d = tubeDistance(p+dir*t)-1.;
    if (d < .005) return 0.;
    visibility=min(visibility,14.*d/t);
    t += max(.015,d*.9);
  }
  return t >= distanceToSun ? visibility : 0.;
}
void main() {
  if (ready < .5) { gl_FragColor=vec4(0.); return; }
  vec4 farPoint=inverseVP*vec4(vUV*2.-1.,1.,1.);
  vec3 ray=normalize(farPoint.xyz/farPoint.w-eye);
  float b=dot(eye,ray), c=dot(eye,eye)-16.;
  float disc=b*b-c;
  if (disc<=0.) { gl_FragColor=vec4(0.); return; }
  float start=max(0.,-b-sqrt(disc)), end=-b+sqrt(disc);
  float z=texture2D(sceneDepth,vUV).r;
  if (z>0.) end=min(end,z/max(.001,dot(ray,forward)));
  if (end<=start) { gl_FragColor=vec4(0.); return; }
  float t=start, transmittance=1.; vec3 sum=vec3(0.);
  float jitter=fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453);
  for (int i=0; i<96; i++) {
    if (t>=end || transmittance<.015) break;
    vec3 p=eye+ray*t;
    float tube=tubeDistance(p);
    float stepLength=min(end-t,max(.055,abs(tube-1.265)-.255));
    vec3 samplePoint=p+ray*(stepLength*(.15+.7*jitter));
    float d=density(samplePoint);
    if (d>.002) {
      vec3 delta=sun-samplePoint;
      float sunDistance=length(delta); vec3 toSun=delta/sunDistance;
      float lit=sunlight(samplePoint,toSun,sunDistance);
      float scatter=pow(max(0.,dot(ray,toSun)),12.);
      float rim=1.-abs(dot(normalize(vec3(samplePoint.x*(1.-2.4/max(.01,length(samplePoint.xz))),
        samplePoint.y,samplePoint.z*(1.-2.4/max(.01,length(samplePoint.xz))))),ray));
      float breath=1.+.12*sin(clock.x*TAU/24.+samplePoint.y*2.);
      vec3 light=vec3(.033,.049,.078)*breath*(.4+.6*rim)
        + lit*vec3(1.,.985,.96)*(1.15+scatter*2.1);
      // Dense interiors transmit less light than the wispy edges.
      light *= .85+.15*exp(-d*.4);
      float opacity=1.-exp(-d*stepLength);
      sum += transmittance*opacity*light;
      transmittance *= 1.-opacity;
    }
    t+=stepLength;
  }
  gl_FragColor=vec4(sum,1.-transmittance);
}`;

/** Half-resolution volume integrated against the actual scene depth, then composited at full size. */
export class TorusFog {
  #weather: WeatherMap | null = null;
  #disposeResources: (() => void) | null = null;
  #phase = 0;
  readonly #sun = Vector3.Zero();
  constructor(scene: Scene) {
    const camera = scene.activeCamera!;
    ShaderStore.ShadersStore.arbestraTorusFogFragmentShader = fragment;
    ShaderStore.ShadersStore.arbestraFogCompositeFragmentShader = `
      precision highp float; varying vec2 vUV;
      uniform sampler2D textureSampler; uniform sampler2D originalScene;
      void main() { vec4 fog=texture2D(textureSampler,vUV);
        vec4 scene=texture2D(originalScene,vUV);
        gl_FragColor=vec4(scene.rgb*(1.-fog.a)+fog.rgb,scene.a); }
    `;
    const bytes = new Uint8Array(32 ** 3);
    let seed = 0x464f4721;
    for (let i = 0; i < bytes.length; i++) { seed = (Math.imul(seed,1664525)+1013904223) >>> 0; bytes[i] = seed >>> 24; }
    const noise = new RawTexture3D(bytes,32,32,32,Constants.TEXTUREFORMAT_R,scene,false,false,Texture.BILINEAR_SAMPLINGMODE);
    noise.wrapU=noise.wrapV=noise.wrapR=Texture.WRAP_ADDRESSMODE;
    const depth = scene.enableDepthRenderer(camera,false,true,Texture.NEAREST_SAMPLINGMODE,true);
    const original = new PassPostProcess('fog-original',1,camera);
    const volume = new PostProcess('torus-fog','arbestraTorusFog',
      ['inverseVP','eye','forward','sun','clock','wind','ready'],['sceneDepth','weatherField','noiseVolume'],
      .5,camera,Texture.BILINEAR_SAMPLINGMODE,scene.getEngine(),false,null,Constants.TEXTURETYPE_HALF_FLOAT);
    const inverse = Matrix.Identity();
    volume.onApply = effect => {
      camera.getTransformationMatrix().invertToRef(inverse);
      effect.setMatrix('inverseVP',inverse); effect.setVector3('eye',camera.globalPosition);
      effect.setVector3('forward',camera.getForwardRay().direction); effect.setVector3('sun',this.#sun);
      effect.setFloat2('clock',this.#weather?.seconds ?? 0,this.#phase);
      const seconds=this.#weather?.seconds ?? 0;
      effect.setFloat3('wind',((seconds*10/WEATHER_DRIFT_SECONDS)%1)*TAU,
        (seconds/WEATHER_DRIFT_SECONDS)%1,(seconds/(WEATHER_DRIFT_SECONDS*2))%1);
      effect.setFloat('ready',this.#weather ? 1 : 0);
      effect.setTexture('sceneDepth',depth.getDepthMap()); effect.setTexture('noiseVolume',noise);
      if (this.#weather) effect.setTexture('weatherField',this.#weather.texture);
    };
    // This input target receives the preceding volume pass; final composite draws to the full viewport.
    const composite = new PostProcess('fog-composite','arbestraFogComposite',[],['originalScene'],.5,camera,
      Texture.BILINEAR_SAMPLINGMODE,scene.getEngine(),false,null,Constants.TEXTURETYPE_HALF_FLOAT);
    composite.onApply = effect => effect.setTextureFromPostProcess('originalScene',original);
    this.#disposeResources=()=>{composite.dispose(camera);volume.dispose(camera);original.dispose(camera);noise.dispose();scene.disableDepthRenderer(camera);};
  }
  dispose(): void { this.#disposeResources?.(); this.#disposeResources=null; this.#weather=null; }
  update(phase: number, sun: Vector3, weather: WeatherMap | null): void {
    this.#weather=weather; this.#phase=cyclePhases(phase).torus; this.#sun.copyFrom(sun);
  }
  /** Conservative observation guard; never discover the eyes through a dense bank. */
  obscures(start: Vector3, end: Vector3): boolean {
    if (!this.#weather) return false;
    const c=Math.cos(this.#phase), s=Math.sin(this.#phase);
    for (let i=0;i<=96;i++) {
      const p=Vector3.Lerp(start,end,i/96), x=c*p.x+s*p.z, z=-s*p.x+c*p.z;
      const tube=Math.hypot(Math.hypot(x,z)-2.4,p.y);
      if (tube<1.015 || tube>1.52) continue;
      const u=Math.atan2(z,x), v=Math.atan2(p.y,Math.hypot(x,z)-2.4);
      const angle=((this.#weather.seconds*10/WEATHER_DRIFT_SECONDS)%1)*TAU, sourceU=u-angle;
      const sourceV=v-2*angle+.35*(Math.sin(3*sourceU)-Math.sin(3*u));
      if (weatherAt(sourceU/TAU,(sourceV-Math.PI)/TAU,COSMOLOGY.epochMs,this.#weather.seed).cloud>.35) return true;
    }
    return false;
  }
}
