// Théorie musicale de Geste Live : degrés de la tonalité, mineur parallèle, bémol,
// « épices » (7e, 9e, 13e) selon la hauteur de la main, voicing et noms d'accords.

export const LETTERS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
export const NOTES_FR = ['Do', 'Do#', 'Ré', 'Mib', 'Mi', 'Fa', 'Fa#', 'Sol', 'Lab', 'La', 'Sib', 'Si'];
export const SCALE_STEPS = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
};
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

/** Poses de la main gauche -> degré (0 = I ... 6 = VII). */
export const POSE_DEGREE = {
  one: 0,
  two: 1,
  peace: 1,
  three: 2,
  four: 3,
  open: 4,
  palm: 4,
  rock: 5,
  hornsThumb: 6,
};

export const SPICE_NAMES = ['triade', '7e', '9e', '13e'];
const SPICE_EDGES = [0.32, 0.52, 0.72];

/** Bande d'épice (0..3) pour une hauteur 0..1, avec hystérésis autour des frontières. */
export function spiceBand(height, previous = null, margin = 0.04) {
  let band = SPICE_EDGES.filter((e) => height >= e).length;
  if (previous !== null && band !== previous) {
    const edge = band > previous ? SPICE_EDGES[band - 1] : SPICE_EDGES[band];
    if (Math.abs(height - edge) < margin) band = previous;
  }
  return band;
}

function scaleNote(steps, degree) {
  const n = steps.length;
  return 12 * Math.floor(degree / n) + steps[((degree % n) + n) % n];
}

/**
 * Accord sur un degré de la tonalité.
 * @param {{root:number, mode:'major'|'minor'}} key root = classe de hauteur 0..11
 * @param {number} degree 0..6
 * @param {{flip?:boolean, flat?:boolean, spice?:number}} opts flip = mineur/majeur parallèle
 * @returns {{rootPc:number, intervals:number[], degree:number, flip:boolean, flat:boolean, spice:number}}
 */
export function buildChord(key, degree, { flip = false, flat = false, spice = 0 } = {}) {
  const mode = flip ? (key.mode === 'major' ? 'minor' : 'major') : key.mode;
  const steps = SCALE_STEPS[mode];
  const base = scaleNote(steps, degree);
  // Empilement de tierces dans la gamme : 1, 3, 5, puis 7, 9, 13 selon l'épice.
  const stack = [0, 2, 4];
  if (spice >= 1) stack.push(6);
  if (spice >= 2) stack.push(8);
  if (spice >= 3) stack.push(12);
  const intervals = stack.map((k) => scaleNote(steps, degree + k) - base);
  const rootPc = (((key.root + base - (flat ? 1 : 0)) % 12) + 12) % 12;
  return { rootPc, intervals, degree, flip, flat, spice };
}

/** Nom de l'accord, ex. « Am9 », « Fmaj7 », « Bm7b5 », « G13 ». */
export function chordName(chord) {
  const iv = new Set(chord.intervals);
  const third = iv.has(4) ? 4 : 3;
  const fifth = iv.has(7) ? 7 : iv.has(6) ? 6 : iv.has(8) ? 8 : 7;
  const seventh = iv.has(11) ? 11 : iv.has(10) ? 10 : iv.has(9) && chord.spice >= 1 ? 9 : null;
  const ext = chord.intervals.some((i) => i >= 20) ? '13' : chord.intervals.some((i) => i >= 13 && i <= 15) ? '9' : seventh ? '7' : '';
  const letter = LETTERS[chord.rootPc];
  if (fifth === 6 && third === 3) {
    if (!seventh) return `${letter}dim`;
    return seventh === 9 ? `${letter}dim7` : `${letter}m${ext === '7' ? '7' : ext}b5`;
  }
  if (fifth === 8 && third === 4) return `${letter}+${ext}`;
  const minor = third === 3 ? 'm' : '';
  if (!ext) return `${letter}${minor}`;
  if (seventh === 11) return `${letter}${minor}maj${ext}`;
  return `${letter}${minor}${ext}`;
}

export function romanName(chord) {
  const r = ROMAN[chord.degree] ?? '?';
  const minor = chord.intervals.includes(3);
  return `${chord.flat ? '♭' : ''}${minor ? r.toLowerCase() : r}`;
}

/**
 * Voicing : basse sur la fondamentale (octave 2), accord serré autour de Do4,
 * `spread` (0..1) ouvre le voicing vers l'aigu.
 * @returns {number[]} notes MIDI triées
 */
export function voice(chord, { spread = 0, bass = true } = {}) {
  const rootLow = 36 + chord.rootPc; // C2..B2
  const rootMid = 48 + chord.rootPc + (chord.rootPc > 6 ? -12 : 0); // autour de Do3..Fa#3
  // Triade et 7e une octave au-dessus de la fondamentale, extensions (9e, 13e) à leur place.
  const notes = chord.intervals.map((iv, i) => {
    let n = iv < 12 ? rootMid + 12 + iv : rootMid + iv;
    if (spread >= 0.4 && i % 2 === 1) n += 12; // voicing ouvert : une note sur deux monte d'une octave
    return n;
  });
  if (spread >= 0.75) notes[0] -= 12;
  const out = bass ? [rootLow, ...notes] : notes;
  return [...new Set(out)].sort((a, b) => a - b);
}

/** Différence entre deux voicings : notes à relâcher et notes à attaquer. */
export function diffNotes(oldNotes, newNotes) {
  const o = new Set(oldNotes);
  const n = new Set(newNotes);
  return { off: oldNotes.filter((x) => !n.has(x)), on: newNotes.filter((x) => !o.has(x)) };
}

export function keyName(key) {
  return `${NOTES_FR[key.root]} ${key.mode === 'major' ? 'majeur' : 'mineur'}`;
}
