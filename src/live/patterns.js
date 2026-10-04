// Générateurs de motifs (fonctions pures, testables) pour la batterie et la basse.
// Une mesure = 16 doubles-croches ; une phrase = 4 mesures (les roulements tombent sur la 4e).

export const DRUM_FAMILIES = ['kick', 'snare', 'hats', 'toms'];
export const DRUM_LEVEL_NAMES = ['silence', 'base', 'fantômes', 'groove', 'roulements'];

// Motifs par famille et par niveau : liste de [pas, vélocité].
const BASE = {
  kick: [
    [],
    [[0, 1], [8, 0.9]],
    [[0, 1], [8, 0.9], [10, 0.45]],
    [[0, 1], [3, 0.6], [8, 0.9], [10, 0.7], [14, 0.5]],
    [[0, 1], [3, 0.6], [6, 0.5], [8, 0.95], [10, 0.7], [14, 0.6]],
  ],
  snare: [
    [],
    [[4, 0.9], [12, 0.9]],
    [[4, 0.9], [7, 0.25], [12, 0.9], [15, 0.3]],
    [[4, 0.95], [7, 0.3], [10, 0.35], [12, 0.95], [15, 0.35]],
    [[2, 0.25], [4, 1], [7, 0.35], [10, 0.4], [12, 1], [13, 0.3], [15, 0.4]],
  ],
  hats: [
    [],
    [[0, 0.6], [4, 0.6], [8, 0.6], [12, 0.6]],
    [0, 2, 4, 6, 8, 10, 12, 14].map((s) => [s, s % 4 === 0 ? 0.7 : 0.4]),
    Array.from({ length: 16 }, (_, s) => [s, s % 4 === 0 ? 0.75 : s % 2 === 0 ? 0.5 : 0.28]),
    Array.from({ length: 16 }, (_, s) => [s, s % 4 === 2 ? 0.85 : s % 2 === 0 ? 0.55 : 0.3]),
  ],
  toms: [
    [],
    [[14, 0.6]],
    [[6, 0.45], [14, 0.6]],
    [[6, 0.5], [11, 0.4], [14, 0.65]],
    [[3, 0.4], [6, 0.55], [11, 0.5], [14, 0.7]],
  ],
};

// Roulements de fin de phrase (4e mesure), ajoutés à partir du niveau 3.
const FILLS = {
  kick: [[12, 0.8], [13, 0.6], [15, 0.9]],
  snare: [[12, 0.6], [13, 0.7], [14, 0.8], [15, 1]],
  hats: [],
  toms: [[8, 0.7], [10, 0.75], [12, 0.8], [13, 0.8], [14, 0.85], [15, 0.9]],
};

/**
 * Vélocités des 16 pas d'une famille pour une mesure donnée.
 * @param {string} family kick | snare | hats | toms
 * @param {number} level 0..4
 * @param {number} bar numéro de mesure (0, 1, 2, ...)
 * @returns {number[]} 16 vélocités (0 = silence)
 */
export function drumBar(family, level, bar = 0) {
  const out = new Array(16).fill(0);
  const lv = Math.max(0, Math.min(4, Math.round(level)));
  for (const [s, v] of BASE[family][lv]) out[s] = v;
  const fillBar = bar % 4 === 3;
  if (fillBar && lv >= 3) {
    if (family === 'hats') for (let s = 12; s < 16; s++) out[s] = 0; // les charlestons laissent la place
    for (const [s, v] of FILLS[family]) if (lv === 4 || s >= 13) out[s] = Math.max(out[s], v);
  }
  return out;
}

export const BASS_PARAMS = ['densité', 'notes', 'octaves', 'groove'];

/**
 * Note de basse au pas `step` (0..15), ou null.
 * @param {{density:number, tones:number, octave:number, feel:number}} p valeurs 0..1
 * @param {{rootPc:number, intervals:number[]}} chord
 * @returns {{midi:number, dur:string, vel:number}|null}
 */
export function bassStep(p, step, bar, chord) {
  if (!chord || p.density <= 0.02) return null;
  let hits;
  if (p.feel >= 0.66) hits = [0, 3, 4, 8, 11, 12]; // galop
  else if (p.feel >= 0.33) hits = [0, 3, 6, 8, 11, 14]; // tresillo 3-3-2
  else if (p.density < 0.3) hits = [0];
  else if (p.density < 0.55) hits = [0, 4, 8, 12];
  else if (p.density < 0.8) hits = [0, 2, 4, 6, 8, 10, 12, 14];
  else hits = [0, 2, 3, 4, 6, 8, 10, 11, 12, 14];
  const i = hits.indexOf(step);
  if (i < 0) return null;

  // Choix de la note : fondamentale, puis quinte, puis autres notes de l'accord.
  const tones = chord.intervals.filter((iv) => iv < 12);
  let iv = 0;
  if (p.tones >= 0.33 && i % 2 === 1) iv = tones.includes(7) ? 7 : tones[tones.length - 1];
  if (p.tones >= 0.66) iv = tones[(i + bar) % tones.length];
  if (p.tones >= 0.9 && step === hits[hits.length - 1]) iv = 11; // note d'approche vers la mesure suivante (sensible)
  let midi = 24 + ((chord.rootPc + iv) % 12); // Do1..Si1
  if (midi < 28) midi += 12; // reste au-dessus de Mi1 (corde grave d'une basse)
  if (p.octave >= 0.33 && i % 2 === 1) midi += 12;
  if (p.octave >= 0.75 && i % 3 === 2) midi += 12;
  return { midi, dur: p.density >= 0.8 ? '16n' : '8n', vel: step % 4 === 0 ? 0.9 : 0.65 };
}
