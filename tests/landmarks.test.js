import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  normalizePose, frameFeatures, frameRef, sequenceFeatures, resampleByTime, POSE_DIM, FRAME_DIM,
} from '../src/core/landmarks.js';
import { synthHand, U, D } from './helpers/synthHand.js';

const fixture = JSON.parse(readFileSync(new URL('../shared/normalize_fixture.json', import.meta.url)));

describe('normalizePose', () => {
  const { world } = synthHand([U, U, D, D, U]);

  it('produit 63 valeurs avec le poignet à l\'origine', () => {
    const f = normalizePose(world, 'Right');
    expect(f).toHaveLength(POSE_DIM);
    expect(f.slice(0, 3)).toEqual([0, 0, 0]);
  });

  it('est invariant à la translation et à l\'échelle', () => {
    const moved = world.map((p) => ({ x: p.x * 2.5 + 1, y: p.y * 2.5 - 3, z: p.z * 2.5 + 0.2 }));
    const a = normalizePose(world, 'Right');
    const b = normalizePose(moved, 'Right');
    a.forEach((v, i) => expect(b[i]).toBeCloseTo(v, 9));
  });

  it('inverse x pour une main « Left »', () => {
    const a = normalizePose(world, 'Right');
    const b = normalizePose(world, 'Left');
    for (let i = 0; i < 21; i++) {
      expect(b[i * 3]).toBeCloseTo(-a[i * 3], 12);
      expect(b[i * 3 + 1]).toBeCloseTo(a[i * 3 + 1], 12);
    }
  });

  it('correspond au fichier de référence partagé avec Python', () => {
    for (const c of fixture.cases) {
      const world = c.world.map(([x, y, z]) => ({ x, y, z }));
      const out = normalizePose(world, c.handedness);
      out.forEach((v, i) => expect(v).toBeCloseTo(c.pose[i], 9));
    }
  });
});

describe('caractéristiques de séquence', () => {
  const hand = (dx) => {
    const { world, image } = synthHand([U, U, U, U, U]);
    return { world, image: image.map((p) => ({ ...p, x: p.x + dx })), handedness: 'Right' };
  };

  it('frameFeatures : 67 valeurs, déplacement relatif et présence', () => {
    const ref = frameRef(hand(0));
    const f = frameFeatures(hand(0.1), ref);
    expect(f).toHaveLength(FRAME_DIM);
    expect(f[63]).toBeGreaterThan(0);
    expect(f[66]).toBe(1);
    expect(frameFeatures(null, ref)).toEqual(new Array(FRAME_DIM).fill(0));
  });

  it('sequenceFeatures correspond au fichier de référence', () => {
    const c = fixture.sequence;
    const hands = c.frames.map((f) =>
      f ? { handedness: f.handedness, world: f.world.map(([x, y, z]) => ({ x, y, z })), image: f.image.map(([x, y, z]) => ({ x, y, z })) } : null,
    );
    const out = sequenceFeatures(hands);
    out.forEach((row, i) => row.forEach((v, j) => expect(v).toBeCloseTo(c.features[i][j], 9)));
  });

  it('resampleByTime renvoie exactement n images', () => {
    const frames = Array.from({ length: 45 }, (_, i) => ({ t: i * 33, hand: i }));
    const out = resampleByTime(frames, 24);
    expect(out).toHaveLength(24);
    expect(out[0]).toBe(0);
    expect(out[23]).toBe(44);
  });
});
