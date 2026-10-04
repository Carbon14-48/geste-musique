import { describe, it, expect } from 'vitest';
import { MotionTracker, StrikeDetector, TempoTracker } from '../src/core/motion.js';

function run(tracker, path, dt = 33) {
  return path.flatMap(([x, y], i) => tracker.update(i * dt, { x, y }, y - 0.1, 0.1).map((e) => e.type));
}

describe('MotionTracker', () => {
  it('détecte un balayage vers la droite', () => {
    const path = Array.from({ length: 12 }, (_, i) => [0.2 + i * 0.05, 0.5]);
    expect(run(new MotionTracker(), path)).toContain('swipe_right');
  });

  it('ne détecte rien pour une main immobile', () => {
    const path = Array.from({ length: 30 }, () => [0.5, 0.5]);
    expect(run(new MotionTracker(), path)).toEqual([]);
  });

  it('détecte un grattage vers le bas', () => {
    const path = Array.from({ length: 10 }, (_, i) => [0.5, 0.3 + i * 0.03]);
    expect(run(new MotionTracker(), path)).toContain('strum');
  });

  it('détecte une frappe (descente rapide puis arrêt)', () => {
    const path = [
      ...Array.from({ length: 6 }, (_, i) => [0.5, 0.3 + i * 0.04]),
      ...Array.from({ length: 6 }, () => [0.5, 0.54]),
    ];
    expect(run(new MotionTracker(), path)).toContain('strike');
  });
});

describe('StrikeDetector', () => {
  it('renvoie la vitesse du pic au freinage', () => {
    const s = new StrikeDetector(5, 0.5);
    const out = [2, 6, 9, 3].map((v) => s.update(v));
    expect(out).toEqual([null, null, null, 9]);
  });
});

describe('TempoTracker', () => {
  it('calcule le tempo à partir des frappes', () => {
    const t = new TempoTracker();
    let bpm = null;
    for (let i = 0; i < 5; i++) bpm = t.tap(i * 500);
    expect(bpm).toBe(120);
  });
});
