import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { decodeHand, poseFingers, HEADS } from '../src/ml/poses.js';
import { classifyPose } from '../src/core/rules.js';
import { HandTracker } from '../src/core/handTracker.js';
import { handFeatures2d, HAND2D_DIM } from '../src/core/landmarks.js';
import { synthHand, U, D } from './helpers/synthHand.js';

const TABLE = JSON.parse(readFileSync(new URL('../shared/pose_fingers.json', import.meta.url)));

describe('table des doigts partagée (shared/pose_fingers.json)', () => {
  it('poseFingers lit la même table que Python', () => {
    for (const [label, bits] of Object.entries(TABLE.poses)) {
      const f = poseFingers(label);
      if (bits === null) expect(f).toBeNull();
      else expect(f.map((b) => (b ? '1' : '0')).join('')).toBe(bits);
    }
  });

  it('les règles géométriques donnent les mêmes doigts que la table pour chaque pose simple', () => {
    for (const label of ['fist', 'one', 'two', 'three', 'four', 'rock', 'hornsThumb', 'call', 'gun']) {
      const st = poseFingers(label).map((up) => (up ? U : D));
      const { world, image } = synthHand(st);
      expect(classifyPose(world, image).fingers).toEqual(poseFingers(label));
    }
  });
});

describe('décodage des 4 sorties du réseau', () => {
  const labels = ['fist', 'one', 'palm'];

  it('pose la plus probable, doigts, comptage, paume et doigts en bas', () => {
    const out = decodeHand(labels, [0.1, 0.7, 0.2], [0.1, 0.9, 0.2, 0.3, 0.1], 0.8, 0.3);
    expect(out.label).toBe('one');
    expect(out.confidence).toBeCloseTo(0.7);
    expect(out.fingers).toEqual([false, true, false, false, false]);
    expect(out.count).toBe(1);
    expect(out.palmFacing).toBe(true);
    expect(out.pointsDown).toBe(false);
    expect(out.probs.palm).toBeCloseTo(0.2);
  });

  it('une sortie non apprise est rendue undefined (le tracker garde alors la mesure)', () => {
    const out = decodeHand(labels, [1, 0, 0], [0, 0, 0, 0, 0], 0.9, 0.9, ['pose', 'fingers', 'down']);
    expect(out.palmFacing).toBeUndefined();
    expect(out.pointsDown).toBe(true);
    expect(HEADS).toEqual(['pose', 'fingers', 'palm', 'down']);
  });
});

/** Modèle factice : renvoie toujours la même prédiction. */
function fakeModel(pred) {
  return {
    input2d: true,
    seen: null,
    predict(x) {
      this.seen = x;
      return pred;
    },
  };
}

function detection(states, label = 'Right') {
  const { world, image } = synthHand(states);
  return { landmarks: [image], worldLandmarks: [world], handedness: [[{ categoryName: label, score: 1 }]] };
}

describe('HandTracker : le réseau décide, les règles ne servent que sans modèle', () => {
  it('sans modèle : règles géométriques', () => {
    const tr = new HandTracker();
    const f = tr.update(detection([D, U, D, D, D]), 0);
    expect(f.hands.right.source).toBe('rules');
    expect(f.hands.right.rawLabel).toBe('one');
    expect(f.hands.right.features2d).toHaveLength(HAND2D_DIM);
  });

  it('avec HandNet : pose, doigts, comptage, paume et doigts en bas viennent du réseau', () => {
    const tr = new HandTracker();
    // La main montre « 1 doigt » mais le réseau dit « cornes » : c'est lui qui gagne.
    tr.poseModel = fakeModel(decodeHand(['rock'], [0.95], [0.1, 0.9, 0.1, 0.1, 0.9], 0.1, 0.9));
    const h = tr.update(detection([D, U, D, D, D]), 0).hands.right;
    expect(h.source).toBe('ai');
    expect(h.rawLabel).toBe('rock');
    expect(h.fingers).toEqual([false, true, false, false, true]);
    expect(h.rawCount).toBe(2);
    expect(h.palmFacing).toBe(false);
    expect(h.pointsDown).toBe(true);
    expect(tr.poseModel.seen).toEqual(h.features2d);
  });

  it('peu sûr de lui : « autre » plutôt qu\'un mauvais accord', () => {
    const tr = new HandTracker();
    tr.poseModel = fakeModel(decodeHand(['one', 'two'], [0.5, 0.5], [0, 1, 0, 0, 0], 0.9, 0.1));
    expect(tr.update(detection([D, U, D, D, D]), 0).hands.right.rawLabel).toBe('other');
  });

  it('réglage « inverser paume / dos » appliqué aussi à la sortie du réseau', () => {
    const tr = new HandTracker();
    tr.invertPalm = true;
    tr.poseModel = fakeModel(decodeHand(['palm'], [1], [1, 1, 1, 1, 1], 0.9, 0.1));
    expect(tr.update(detection([U, U, U, U, U]), 0).hands.right.palmFacing).toBe(false);
  });
});

describe('handFeatures2d', () => {
  it('invariante à la position et à la taille, miroir pour la main gauche', () => {
    const { image } = synthHand([U, U, D, D, U]);
    const a = handFeatures2d(image, 'Right', 1);
    const moved = image.map((p) => ({ x: 0.2 + (p.x - 0.5) * 0.5, y: 0.3 + (p.y - 0.6) * 0.5 }));
    handFeatures2d(moved, 'Right', 1).forEach((v, i) => expect(v).toBeCloseTo(a[i], 9));
    const left = handFeatures2d(image, 'Left', 1);
    expect(left[2]).toBeCloseTo(-a[2], 9);
    expect(left[3]).toBeCloseTo(a[3], 9);
  });
});

// Le modèle entraîné en Python (public/models/hand/) se charge dans TF.js et reconnaît les mains synthétiques.
const MODEL_DIR = new URL('../public/models/hand/', import.meta.url);
describe.runIf(existsSync(new URL('model.json', MODEL_DIR)))('modèle HandNet publié', () => {
  it('se charge avec TensorFlow.js et donne 4 sorties cohérentes', async () => {
    const tf = await import('@tensorflow/tfjs');
    const { HandModel } = await import('../src/ml/handModel.js');
    const json = JSON.parse(readFileSync(new URL('model.json', MODEL_DIR)));
    const weights = readFileSync(new URL(json.weightsManifest[0].paths[0], MODEL_DIR));
    const model = await tf.loadLayersModel(
      tf.io.fromMemory({
        modelTopology: json.modelTopology,
        weightSpecs: json.weightsManifest[0].weights,
        weightData: weights.buffer.slice(weights.byteOffset, weights.byteOffset + weights.byteLength),
      }),
    );
    const meta = JSON.parse(readFileSync(new URL('labels.json', MODEL_DIR)));
    const hand = new HandModel(model, meta.labels, meta);
    const pred = hand.predict(handFeatures2d(synthHand([U, U, U, U, U]).image, 'Right', 1));
    expect(meta.labels).toContain(pred.label);
    expect(pred.fingers).toHaveLength(5);
    expect(pred.confidence).toBeGreaterThan(0);
    hand.dispose();
  });
});
