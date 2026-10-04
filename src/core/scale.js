// Gammes, noms de notes et quantification (pour le thérémine « aimanté »).

export const NOTE_NAMES_FR = ['Do', 'Do#', 'Ré', 'Ré#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'];

export const SCALES = {
  pentatonique: { name: 'Pentatonique majeure', steps: [0, 2, 4, 7, 9] },
  majeure: { name: 'Majeure', steps: [0, 2, 4, 5, 7, 9, 11] },
  mineure: { name: 'Mineure naturelle', steps: [0, 2, 3, 5, 7, 8, 10] },
  pentaMineure: { name: 'Pentatonique mineure', steps: [0, 3, 5, 7, 10] },
  blues: { name: 'Blues', steps: [0, 3, 5, 6, 7, 10] },
  chromatique: { name: 'Chromatique', steps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
};

export function midiToFreq(midi) {
  return 440 * 2 ** ((midi - 69) / 12);
}

export function freqToMidi(freq) {
  return 69 + 12 * Math.log2(freq / 440);
}

export function midiToName(midi) {
  const m = Math.round(midi);
  return `${NOTE_NAMES_FR[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
}

/**
 * Note MIDI d'un degré de la gamme (0 = tonique). Les degrés au-delà de la gamme montent d'octave.
 * @param {number} root note MIDI de la tonique (ex. 60 = Do4)
 */
export function degreeToMidi(root, scaleKey, degree) {
  const steps = SCALES[scaleKey]?.steps ?? SCALES.majeure.steps;
  const n = steps.length;
  const octave = Math.floor(degree / n);
  const idx = ((degree % n) + n) % n;
  return root + 12 * octave + steps[idx];
}

/** Ramène une hauteur continue (MIDI flottant) sur la note de la gamme la plus proche. */
export function quantize(midi, root, scaleKey) {
  const steps = SCALES[scaleKey]?.steps ?? SCALES.chromatique.steps;
  let best = midi;
  let bestDist = Infinity;
  const base = Math.floor((midi - root) / 12);
  for (let o = base - 1; o <= base + 1; o++) {
    for (const s of steps) {
      const cand = root + 12 * o + s;
      const d = Math.abs(cand - midi);
      if (d < bestDist) {
        bestDist = d;
        best = cand;
      }
    }
  }
  return best;
}

/** Accord (triade) construit sur un degré de la gamme. */
export function triad(root, scaleKey, degree) {
  return [0, 2, 4].map((k) => degreeToMidi(root, scaleKey, degree + k));
}

/** Accords de guitare (catalogue section 7) : 1 = Do, 2 = Sol, 3 = La mineur, 4 = Fa, 5 = Mi mineur. */
export const GUITAR_CHORDS = {
  1: { name: 'Do', notes: [48, 52, 55, 60, 64] },
  2: { name: 'Sol', notes: [43, 47, 50, 55, 59, 67] },
  3: { name: 'La m', notes: [45, 52, 57, 60, 64] },
  4: { name: 'Fa', notes: [41, 48, 53, 57, 60, 65] },
  5: { name: 'Mi m', notes: [40, 47, 52, 55, 59, 64] },
};
