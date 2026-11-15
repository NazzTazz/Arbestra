import { describe, expect, it } from 'vitest';
import { CameraMotion } from './camera-motion';

const pose = (x = 1, alpha = 0.5, radius = 40) => ({ target: { x, y: 0.45, z: 2 }, alpha, beta: 0.84, radius });

describe('CameraMotion', () => {
  it('ignores view notifications with an unchanged pose, so a resize cannot feed the motion scaling', () => {
    const motion = new CameraMotion();
    expect(motion.moved(pose())).toBe(true);
    // The resize loop of 15 November: every lower then higher resolution notified the same pose.
    for (let i = 0; i < 20; i++) expect(motion.moved(pose())).toBe(false);
  });

  it('counts any change of target, angle or distance as motion', () => {
    const motion = new CameraMotion();
    motion.moved(pose());
    expect(motion.moved(pose(1.0001))).toBe(true);
    expect(motion.moved(pose(1.0001, 0.6))).toBe(true);
    expect(motion.moved(pose(1.0001, 0.6, 41))).toBe(true);
    expect(motion.moved({ ...pose(1.0001, 0.6, 41), beta: 0.9 })).toBe(true);
    expect(motion.moved({ ...pose(1.0001, 0.6, 41), beta: 0.9 })).toBe(false);
  });
});
