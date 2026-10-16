import { afterEach, expect, it, vi } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { SceneInstrumentation } from '@babylonjs/core/Instrumentation/sceneInstrumentation';
import { RenderDiagnostics } from './render-diagnostics';
import { setStatisticsEnabled, statisticsSnapshot } from './statistics';

afterEach(() => { setStatisticsEnabled(false); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it('reports unsupported GPU timing as unknown and stops collectors on disable/dispose', () => {
  vi.stubEnv('DEV', true); vi.stubGlobal('document', { hidden: false, removeEventListener: vi.fn() }); setStatisticsEnabled(true);
  const engine = new NullEngine(), scene = new Scene(engine), stats = new SceneInstrumentation(scene);
  const diagnostics = new RenderDiagnostics(engine, scene, stats);
  try {
    diagnostics.afterRender(scene, 'village');
    expect(statisticsSnapshot().rendering.gpu).toMatchObject({ supported: false, count: 0, meanMs: null });
    expect(stats.captureParticlesRenderTime).toBe(true);
    setStatisticsEnabled(false);
    expect(stats.captureParticlesRenderTime).toBe(false); expect(stats.captureRenderTargetsRenderTime).toBe(false);
    diagnostics.afterRender(scene, 'village'); expect(statisticsSnapshot().rendering.count).toBe(0);
  } finally { diagnostics.dispose(); scene.dispose(); engine.dispose(); }
});

it('records each completed GPU timer only once and excludes a pending result from the previous activation', () => {
  vi.stubEnv('DEV', true); vi.stubGlobal('document', { hidden: false, removeEventListener: vi.fn() }); setStatisticsEnabled(true);
  const engine = new NullEngine(), scene = new Scene(engine);
  // Counter delivery is simulated, never a claim that NullEngine measures a GPU.
  engine.getCaps().timerQuery = {} as NonNullable<ReturnType<typeof engine.getCaps>['timerQuery']>;
  const diagnostics = new RenderDiagnostics(engine, scene, new SceneInstrumentation(scene));
  const counter = engine.getGPUFrameTimeCounter();
  const deliver = () => { counter.fetchNewFrame(); counter.addCount(5_000_000, true); diagnostics.afterRender(scene, 'village'); };
  try {
    deliver(); for (let i = 0; i < 5; i++) diagnostics.afterRender(scene, 'village');
    expect(statisticsSnapshot().rendering.gpu).toMatchObject({ count: 1, meanMs: 5 });
    setStatisticsEnabled(false); setStatisticsEnabled(true); deliver();
    expect(statisticsSnapshot().rendering.gpu.count).toBe(0);
    deliver(); expect(statisticsSnapshot().rendering.gpu.count).toBe(1);
  } finally { diagnostics.dispose(); scene.dispose(); engine.dispose(); }
});
