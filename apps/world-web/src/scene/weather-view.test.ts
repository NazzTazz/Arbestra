import { afterEach, expect, it, vi } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { WeatherMap } from './weather-view';

afterEach(() => vi.unstubAllGlobals());

function stubCanvas() {
  const painted: number[] = [];
  vi.stubGlobal(
    'OffscreenCanvas',
    class {
      constructor(
        public width: number,
        public height: number,
      ) {}
      getContext() {
        return { clearRect() {}, putImageData: () => painted.push(performance.now()) };
      }
    },
  );
  vi.stubGlobal(
    'ImageData',
    class {
      data: Uint8ClampedArray;
      constructor(width: number, height: number) {
        this.data = new Uint8ClampedArray(width * height * 4);
      }
    },
  );
  return painted;
}

it('paints the first weather field in the update that creates it, then 2 ms slices per frame', () => {
  const painted = stubCanvas();
  const engine = new NullEngine(),
    scene = new Scene(engine);
  try {
    const map = new WeatherMap(scene, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    const now = Date.UTC(2026, 10, 3, 21);
    // Before the first field the ground showed dry and cloudless, then darkened
    // a few seconds after the village appeared.
    map.update(now);
    expect(map.paintedAt).toBe(now);
    expect(painted).toHaveLength(1);
    // The next field (2 s later) is spread over frames again.
    const started = performance.now();
    map.update(now + 2000);
    expect(performance.now() - started).toBeLessThan(50);
    expect(map.paintedAt).toBe(now);
  } finally {
    scene.dispose();
    engine.dispose();
  }
});
