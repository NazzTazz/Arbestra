import { describe, expect, it } from 'vitest';
import kit from './villager-kit.json';
import {
  GESTURE_BLOCK_S,
  GARDEN_TUFTS,
  StrikePlan,
  gardenPose,
  gardenStride,
  gardenTuftTime,
  gestureSeed,
  newPose,
  sawPose,
  sawStroke,
  strikePose,
  teamActivity,
  walkPose,
} from './worker-gestures';

const close = (a: object, b: object) => {
  for (const [k, v] of Object.entries(b)) expect((a as Record<string, number>)[k]).toBeCloseTo(v as number, 5);
};

describe('worksite gestures', () => {
  it('holds the exported impact and preparation poses', () => {
    const out = newPose(),
      s = kit.strike;
    strikePose(s.prep + s.hold / 2, 'hache', out);
    close(out, kit.gestures.hache.prep);
    strikePose(s.impact_u + s.impact / 2, 'hache', out);
    close(out, kit.gestures.hache.hit);
    strikePose(0, 'pioche', out);
    close(out, kit.gestures.pioche.rest);
  });

  it('evaluates the same pose by stepping or by jumping, for the same seed', () => {
    const stepped = new StrikePlan(gestureSeed('w:v:site', 2), 'pioche'),
      fresh = () => new StrikePlan(gestureSeed('w:v:site', 2), 'pioche'),
      a = newPose(),
      b = newPose();
    for (let t = 0; t < 95; t += 1 / 30) stepped.pose(t, 600, a);
    for (const t of [3.2, 31.7, 64.05, 94.9]) {
      stepped.pose(t, 600, a);
      fresh().pose(t, 600, b);
      close(a, b);
    }
    expect(gestureSeed('w:v:site', 2)).not.toBe(gestureSeed('w:v:site', 3));
  });

  it('draws cadences within ±12 % and pauses every 4 to 9 strikes', () => {
    const plan = new StrikePlan(gestureSeed('w:v:pierre', 0), 'masse'),
      period = kit.gestures.masse.period;
    let series = 0;
    for (let block = 0; block < 40; block++) {
      const segments = plan.segments(block);
      expect(segments.at(-1)!.t1).toBeLessThanOrEqual(GESTURE_BLOCK_S);
      for (const s of segments) {
        const length = s.t1 - s.t0;
        if (s.pause < 0) {
          expect(length).toBeGreaterThanOrEqual(period * 0.88 - 1e-9);
          expect(length).toBeLessThanOrEqual(period * 1.12 + 1e-9);
          series++;
        } else {
          expect(series).toBeGreaterThanOrEqual(4);
          expect(series).toBeLessThanOrEqual(9);
          expect(length).toBeGreaterThanOrEqual(0.6);
          expect(length).toBeLessThanOrEqual(2.5);
          series = 0;
        }
      }
      series = 0;
    }
  });

  it('starts no strike after the server end and rests within 0.4 s', () => {
    const rest = kit.gestures.hache.rest,
      out = newPose();
    for (let i = 0; i < 25; i++) {
      const plan = new StrikePlan(gestureSeed('fin', i), 'hache'),
        end = 40 + i * 0.37;
      for (let t = end + 0.4; t < end + 6; t += 0.05) close(plan.pose(t, end, out), rest);
    }
  });

  it('saws in opposite phase and pauses the pair together', () => {
    const seed = gestureSeed('w:v:bois', 100),
      a = newPose(),
      b = newPose();
    let paused = 0;
    for (let t = 0; t < 60; t += 0.1) {
      const stroke = sawStroke(seed, t);
      sawPose(stroke, false, a);
      sawPose(stroke, true, b);
      expect(a.bR - kit.saw.arms).toBeCloseTo(-(b.bR - kit.saw.arms), 6);
      if (stroke === 0) paused++;
    }
    expect(paused).toBeGreaterThan(0);
    expect(paused).toBeLessThan(200);
  });

  it('reduces the stride by 30 % when carrying', () => {
    const free = newPose(),
      loaded = newPose();
    walkPose(Math.PI / 2, false, free);
    walkPose(Math.PI / 2, true, loaded);
    expect(loaded.jR).toBeCloseTo(free.jR * 0.7, 6);
    expect(loaded.bR).toBeCloseTo(kit.poses.porter.bR, 6);
  });

  it('shares small teams’ blocks between their tasks without a fixed 12-second cycle', () => {
    const seed = gestureSeed('w:v:solo', 0),
      seen = new Set<string>();
    for (let t = 0; t < GESTURE_BLOCK_S; t += 0.5) seen.add(teamActivity(seed, 'stone', 1, 'pick', t));
    expect([...seen]).toEqual(['pick', 'break', 'carry']);
    expect(teamActivity(seed, 'stone', 3, 'pick', 25)).toBe('pick');
    const wood = Array.from({ length: 60 }, (_, i) => teamActivity(seed, 'wood', 2, 'saw', i));
    expect(wood).toContain('saw');
    expect(wood).toContain('wood-chop');
  });
});

describe('garden harvest gesture', () => {
  it('pulls each tuft within one frame of its disappearance', () => {
    const duration = 120,
      out = newPose();
    for (let k = 0; k < GARDEN_TUFTS; k++) {
      const tk = gardenTuftTime(k, duration);
      expect(gardenPose(1, tk - 1 / 30, duration, out)).toBe(false);
      expect(out.buste).toBeGreaterThan(kit.poses.penche.buste - 0.05);
      expect(gardenPose(1, tk + 1 / 30, duration, out)).toBe(true);
    }
  });

  it('compresses the sequence of a short window without crossing the next tuft', () => {
    const duration = 12 * 1.4,
      out = newPose();
    for (let k = 0; k < GARDEN_TUFTS - 1; k++) {
      const next = gardenTuftTime(k + 1, duration);
      expect(gardenPose(7, next - 1 / 30, duration, out)).toBe(false);
      expect(out.buste).toBeGreaterThan(0.85);
    }
  });

  it('stops along the sweep while pulling and keeps moving forward', () => {
    const duration = 120;
    let previous = 0;
    for (let p = 0; p <= 1; p += 0.001) {
      const q = gardenStride(p, duration);
      expect(q).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = q;
    }
    expect(gardenStride(0, duration)).toBe(0);
    expect(gardenStride(1, duration)).toBeCloseTo(1, 9);
    const tk = gardenTuftTime(4, duration) / duration;
    expect(gardenStride(tk - 0.002, duration)).toBe(gardenStride(tk + 0.005, duration));
  });
});
