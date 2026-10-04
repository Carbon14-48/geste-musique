import { describe, it, expect } from 'vitest';
import { OneEuroFilter } from '../src/core/oneEuro.js';
import { degreeToMidi, quantize, midiToName, triad, midiToFreq } from '../src/core/scale.js';
import { KnnClassifier } from '../src/ml/knn.js';
import { encodeMidiFile } from '../src/audio/midiFile.js';

describe('OneEuroFilter', () => {
  it('garde une valeur constante', () => {
    const f = new OneEuroFilter();
    let v;
    for (let i = 0; i < 20; i++) v = f.filter(1.5, i / 30);
    expect(v).toBeCloseTo(1.5, 9);
  });

  it('réduit le bruit d\'une main immobile', () => {
    const f = new OneEuroFilter({ minCutoff: 1, beta: 0 });
    const noisy = Array.from({ length: 200 }, (_, i) => 0.5 + (i % 2 ? 0.01 : -0.01));
    const out = noisy.map((v, i) => f.filter(v, i / 30));
    const spread = (a) => Math.max(...a) - Math.min(...a);
    expect(spread(out.slice(100))).toBeLessThan(spread(noisy) / 3);
  });
});

describe('gammes', () => {
  it('pentatonique : Do Ré Mi Sol La', () => {
    expect([0, 1, 2, 3, 4, 5].map((d) => degreeToMidi(60, 'pentatonique', d))).toEqual([60, 62, 64, 67, 69, 72]);
  });
  it('quantifie sur la gamme', () => {
    expect(quantize(61.2, 60, 'pentatonique')).toBe(62);
    expect(quantize(65.4, 60, 'majeure')).toBe(65);
  });
  it('noms et fréquences', () => {
    expect(midiToName(60)).toBe('Do4');
    expect(midiToName(69)).toBe('La4');
    expect(midiToFreq(69)).toBeCloseTo(440);
    expect(triad(60, 'majeure', 0)).toEqual([60, 64, 67]);
  });
});

describe('KnnClassifier', () => {
  it('reconnaît le geste le plus proche', () => {
    const knn = new KnnClassifier(3);
    for (let i = 0; i < 5; i++) {
      knn.add('a', [0 + i * 0.01, 0]);
      knn.add('b', [1 + i * 0.01, 1]);
    }
    expect(knn.predict([0.02, 0.01]).label).toBe('a');
    expect(knn.predict([0.98, 1.02]).label).toBe('b');
    expect(knn.countByLabel()).toEqual({ a: 5, b: 5 });
  });
});

describe('fichier MIDI', () => {
  it('écrit un en-tête valide et les notes', () => {
    const bytes = encodeMidiFile([
      { time: 0, type: 'on', note: 60, velocity: 1 },
      { time: 0.5, type: 'off', note: 60 },
    ], 120);
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('MThd');
    expect(String.fromCharCode(...bytes.slice(14, 18))).toBe('MTrk');
    // 0,5 s à 120 BPM et 480 ticks par noire = 480 ticks = 0x83 0x60 en longueur variable
    const idx = bytes.indexOf(0x80);
    expect([bytes[idx - 2], bytes[idx - 1]]).toEqual([0x83, 0x60]);
  });
});
