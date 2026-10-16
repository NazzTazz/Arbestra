import type { Engine } from '@babylonjs/core/Engines/engine';
import '@babylonjs/core/Engines/Extensions/engine.query';
import { EngineInstrumentation } from '@babylonjs/core/Instrumentation/engineInstrumentation';
import { SceneInstrumentation } from '@babylonjs/core/Instrumentation/sceneInstrumentation';
import type { Scene } from '@babylonjs/core/scene';
import { recordGpuTiming, recordRenderMetrics, statisticsEnabled, subscribeStatistics } from './statistics';

/** GPU queries are asynchronous: record each newly completed sample once. */
export class RenderDiagnostics {
  readonly #engineStats: EngineInstrumentation;
  readonly #scenes = new Map<Scene, SceneInstrumentation>();
  readonly #unsubscribe: () => void;
  #gpuCount = 0;
  #shaderTotal = 0;
  #enabled = false;
  #discardGpuResult = false;
  constructor(private readonly engine: Engine, scene: Scene, stats: SceneInstrumentation) {
    this.#engineStats = new EngineInstrumentation(engine);
    this.#scenes.set(scene, stats);
    this.#unsubscribe = subscribeStatistics(() => this.#configure());
    this.#configure();
  }
  #configure() {
    const enabled = statisticsEnabled();
    this.#enabled = enabled;
    const stats = this.#engineStats;
    // A pending timer can outlive disabling collection. Do not attribute its
    // eventual result (possibly spanning the pause) to the next activation.
    this.#discardGpuResult ||= stats.captureGPUFrameTime;
    stats.captureGPUFrameTime = enabled && Boolean(this.engine.getCaps().timerQuery);
    stats.captureShaderCompilationTime = enabled;
    this.#gpuCount = stats.gpuFrameTimeCounter.count;
    this.#shaderTotal = stats.shaderCompilationTimeCounter.total;
    for (const scene of this.#scenes.values()) {
      scene.captureParticlesRenderTime = enabled;
      scene.captureRenderTargetsRenderTime = enabled;
    }
    if (enabled) recordGpuTiming(Boolean(this.engine.getCaps().timerQuery));
  }
  beforeRender(scene: Scene): void {
    if (!this.#enabled || this.#scenes.has(scene)) return;
    const stats = new SceneInstrumentation(scene);
    stats.captureActiveMeshesEvaluationTime = true; stats.captureRenderTime = true;
    stats.captureParticlesRenderTime = true; stats.captureRenderTargetsRenderTime = true;
    this.#scenes.set(scene, stats);
    scene.onDisposeObservable.addOnce(() => { stats.dispose(); this.#scenes.delete(scene); });
  }
  afterRender(scene: Scene, mode: 'village' | 'world'): void {
    if (!this.#enabled) return;
    const stats = this.#scenes.get(scene); if (!stats) return;
    const shaderTotal = this.#engineStats.shaderCompilationTimeCounter.total;
    recordRenderMetrics(mode, {
      activeMeshesMs: stats.activeMeshesEvaluationTimeCounter.current,
      submissionMs: stats.renderTimeCounter.current,
      particlesMs: stats.particlesRenderTimeCounter.current,
      renderTargetsMs: stats.renderTargetsRenderTimeCounter.current,
      shaderMs: Math.max(0, shaderTotal - this.#shaderTotal),
      drawCalls: stats.drawCallsCounter.current,
      activeMeshes: scene.getActiveMeshes().length, residentMeshes: scene.meshes.length,
    });
    this.#shaderTotal = shaderTotal;
    // The engine completes queries at endFrame: this reads a previous GPU frame.
    // Missing/disjoint results do not advance the counter and are not measurements.
    const gpu = this.#engineStats.gpuFrameTimeCounter;
    if (gpu.count > this.#gpuCount) {
      if (!this.#discardGpuResult) recordGpuTiming(true, gpu.current);
      this.#discardGpuResult = false; this.#gpuCount = gpu.count;
    }
  }
  dispose(): void {
    this.#unsubscribe();
    this.#engineStats.captureGPUFrameTime = false;
    this.#engineStats.captureShaderCompilationTime = false;
    this.#engineStats.dispose();
    for (const stats of this.#scenes.values()) stats.dispose();
    this.#scenes.clear();
  }
}
