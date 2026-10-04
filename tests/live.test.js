import { describe, it, expect } from 'vitest';
import { buildChord, chordName, romanName, spiceBand, voice, diffNotes } from '../src/live/theory.js';
import { drumBar, bassStep } from '../src/live/patterns.js';
import { PinchTracker } from '../src/live/pinch.js';
import { ArcSelector } from '../src/live/arc.js';
import { ChordHand } from '../src/live/chordHand.js';
import { laneNote } from '../src/live/rightModes.js';
import { classifyPose, palmFacingCamera } from '../src/core/rules.js';
import { synthHand, U, D } from './helpers/synthHand.js';

const A_MINOR = { root: 9, mode: 'minor' };
const C_MAJOR = { root: 0, mode: 'major' };
const name = (key, degree, opts) => chordName(buildChord(key, degree, opts));

describe('théorie', () => {
  it('degrés de Do majeur', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map((d) => name(C_MAJOR, d))).toEqual(['C', 'Dm', 'Em', 'F', 'G', 'Am', 'Bdim']);
  });

  it('épices : 7e, 9e, 13e', () => {
    expect(name(C_MAJOR, 0, { spice: 1 })).toBe('Cmaj7');
    expect(name(C_MAJOR, 1, { spice: 1 })).toBe('Dm7');
    expect(name(C_MAJOR, 4, { spice: 1 })).toBe('G7');
    expect(name(A_MINOR, 0, { spice: 2 })).toBe('Am9');
    expect(name(C_MAJOR, 4, { spice: 3 })).toBe('G13');
    expect(name(C_MAJOR, 6, { spice: 1 })).toBe('Bm7b5');
  });

  it('dos de la main = mode parallèle, doigts vers le bas = bémol', () => {
    expect(name(C_MAJOR, 0, { flip: true })).toBe('Cm');
    expect(name(A_MINOR, 0, { flip: true })).toBe('A');
    expect(name(C_MAJOR, 0, { flat: true })).toBe('B');
    expect(romanName(buildChord(C_MAJOR, 5))).toBe('vi');
  });

  it('bandes d\'épices avec hystérésis', () => {
    expect([0.1, 0.4, 0.6, 0.9].map((h) => spiceBand(h))).toEqual([0, 1, 2, 3]);
    expect(spiceBand(0.33, 0)).toBe(0); // juste au-dessus de la frontière : on garde la bande précédente
    expect(spiceBand(0.4, 0)).toBe(1);
  });

  it('voicing : basse + accord, notes triées et sans doublon', () => {
    const notes = voice(buildChord(A_MINOR, 0, { spice: 2 }));
    expect(notes[0]).toBe(45); // La2
    expect([...notes].sort((a, b) => a - b)).toEqual(notes);
    expect(new Set(notes.map((n) => n % 12))).toEqual(new Set([9, 0, 4, 7, 11]));
  });

  it('diffNotes ne relance que ce qui change', () => {
    expect(diffNotes([45, 57, 60, 64], [45, 57, 60, 64, 67])).toEqual({ off: [], on: [67] });
    expect(diffNotes([45, 57, 60], [41, 57, 60])).toEqual({ off: [45], on: [41] });
  });
});

describe('motifs', () => {
  it('batterie : niveau 0 = silence, niveaux croissants = plus de coups', () => {
    const hits = (lv) => drumBar('snare', lv, 0).filter((v) => v > 0).length;
    expect(hits(0)).toBe(0);
    expect(hits(1)).toBe(2);
    expect(hits(2)).toBeGreaterThan(hits(1));
    expect(hits(4)).toBeGreaterThan(hits(3));
  });

  it('batterie : roulement de toms sur la 4e mesure au niveau 4', () => {
    const normal = drumBar('toms', 4, 0).filter((v) => v > 0).length;
    const fill = drumBar('toms', 4, 3).filter((v) => v > 0).length;
    expect(fill).toBeGreaterThan(normal);
  });

  it('basse : suit la fondamentale de l\'accord et se tait à densité nulle', () => {
    const chord = buildChord(C_MAJOR, 4); // G
    expect(bassStep({ density: 0, tones: 0, octave: 0, feel: 0 }, 0, 0, chord)).toBeNull();
    const n = bassStep({ density: 0.5, tones: 0, octave: 0, feel: 0 }, 0, 0, chord);
    expect(n.midi % 12).toBe(7);
    expect(bassStep({ density: 0.5, tones: 0, octave: 0, feel: 0 }, 1, 0, chord)).toBeNull();
  });

  it('basse : le groove tresillo place des notes sur 0, 3, 6', () => {
    const p = { density: 0.5, tones: 0, octave: 0, feel: 0.5 };
    const steps = Array.from({ length: 8 }, (_, s) => (bassStep(p, s, 0, buildChord(C_MAJOR, 0)) ? s : null)).filter((s) => s !== null);
    expect(steps).toEqual([0, 3, 6]);
  });

  it('mélodie : couloirs dans la gamme', () => {
    expect([0, 1, 2].map((l) => laneNote(A_MINOR, l, 1))).toEqual([69, 71, 72]);
  });
});

const handWith = (pinches, fingers = [false, true, true, true, true], speed = 0) => ({ pinches, fingers, velocity: { speed } });

describe('pincement', () => {
  it('commence sous le seuil, finit au-dessus du seuil de sortie (hystérésis)', () => {
    const p = new PinchTracker({ on: 0.3, off: 0.45 });
    expect(p.update(handWith([0.2, 1, 1, 1])).started).toBe(0);
    expect(p.update(handWith([0.4, 1, 1, 1])).finger).toBe(0);
    expect(p.update(handWith([0.5, 1, 1, 1])).ended).toBe(0);
  });

  it('refuse un pincement si la main bouge ou si aucun autre doigt n\'est levé', () => {
    expect(new PinchTracker().update(handWith([0.2, 1, 1, 1], undefined, 5)).finger).toBeNull();
    expect(new PinchTracker().update(handWith([0.2, 1, 1, 1], [false, false, false, false, false])).finger).toBeNull();
  });
});

const rhand = (label, palmFacing, x = 0.5) => ({ label, palmFacing, palm: { x, y: 0.5 }, size: 0.1 });

describe('arc des modes', () => {
  it('poing dos -> ouvert, glisser -> case, main ouverte paume -> choix', () => {
    const arc = new ArcSelector({ summonFrames: 3 });
    let ev;
    for (let i = 0; i < 3; i++) ev = arc.update(rhand('fist', false), i * 33);
    expect(ev.type).toBe('opened');
    arc.update(rhand('fist', false, 0.5 + 0.22), 200); // +2 cases
    expect(arc.hover).toBe(4);
    expect(arc.update(rhand('open', true, 0.72), 250)).toEqual({ type: 'selected', mode: 'sculpt' });
  });

  it('main ouverte dos à la caméra = annuler', () => {
    const arc = new ArcSelector({ summonFrames: 1 });
    arc.update(rhand('fist', false), 0);
    expect(arc.update(rhand('open', false), 50).type).toBe('cancelled');
  });

  it('un poing paume vers la caméra n\'ouvre pas l\'arc (sauf arc simplifié)', () => {
    const arc = new ArcSelector({ summonFrames: 1 });
    expect(arc.update(rhand('fist', true), 0).type).toBe(null);
    const simple = new ArcSelector({ summonFrames: 1, requireBack: false });
    expect(simple.update(rhand('fist', true), 0).type).toBe('opened');
  });
});

describe('main gauche', () => {
  const fakeAudio = () => {
    const calls = [];
    return { calls, ready: false, setPadTone() {}, setChord: (n) => calls.push(['set', n]), releaseChord: () => calls.push(['release']) };
  };
  const left = (label, height = 0.1, palmFacing = true) => ({ label, palmFacing, pointsDown: false, roll: 0.5, height });

  it('tenir 3 doigts joue l\'accord III, monter la main ajoute des notes, lâcher relâche', () => {
    const audio = fakeAudio();
    const ch = new ChordHand(audio);
    let st;
    for (let i = 0; i < 4; i++) st = ch.update(left('three'), C_MAJOR, 0.1, i * 33);
    expect(st.name).toBe('Em');
    const before = audio.calls.at(-1)[1].length;
    st = ch.update(left('three'), C_MAJOR, 0.6, 200);
    expect(st.name).toBe('Em9');
    expect(audio.calls.at(-1)[1].length).toBeGreaterThan(before);
    for (let i = 0; i < 5; i++) st = ch.update(null, C_MAJOR, 0, 300 + i * 33);
    expect(st).toBeNull();
    expect(audio.calls.at(-1)).toEqual(['release']);
  });

  it('cornes + pouce = VII', () => {
    const { world, image } = synthHand([U, U, D, D, U]);
    expect(classifyPose(world, image).label).toBe('hornsThumb');
  });
});

describe('orientation de la paume', () => {
  it('suit la convention MediaPipe (image brute, étiquette « selfie »)', () => {
    const { image } = synthHand([U, U, U, U, U]); // pouce à gauche de l'image brute
    expect(palmFacingCamera(image, 'Right')).toBe(true); // vraie main gauche, paume vers la caméra
    expect(palmFacingCamera(image, 'Left')).toBe(false); // vraie main droite vue de dos
  });
});

import { sampleUrls, cycleInstrument, INSTRUMENTS, fileToNote } from '../src/live/instruments.js';
import { puppetPoints, blendPose, POSES } from '../src/live/puppet.js';
import { LESSONS, sampleLesson } from '../src/live/tutorial.js';

describe('instruments', () => {
  it('convertit les noms de fichiers en notes', () => {
    expect(fileToNote('As4')).toBe('A#4');
    const urls = sampleUrls('violin');
    expect(urls.A4).toBe('A4.mp3');
    expect(sampleUrls('synth')).toBeNull();
  });

  it('passe à l\'instrument suivant / précédent en boucle', () => {
    expect(cycleInstrument('piano', 1)).toBe(INSTRUMENTS[1].id);
    expect(cycleInstrument('piano', -1)).toBe(INSTRUMENTS[INSTRUMENTS.length - 1].id);
  });
});

describe('main animée du tutoriel', () => {
  const tipY = (pose, f) => puppetPoints(pose).fingers[f][3].y;

  it('un doigt replié a son bout plus bas qu\'un doigt tendu', () => {
    expect(tipY(POSES.fist, 1)).toBeGreaterThan(tipY(POSES.open, 1));
  });

  it('le pincement amène le bout du pouce sur le bout de l\'index', () => {
    const { thumb, fingers } = puppetPoints(POSES.pinchIndex);
    expect(Math.hypot(thumb[3].x - fingers[0][3].x, thumb[3].y - fingers[0][3].y)).toBeLessThan(1e-9);
  });

  it('interpole les poses sans valeur invalide', () => {
    const mid = blendPose(POSES.fist, POSES.pinchIndex, 0.5);
    const pts = puppetPoints(mid);
    for (const p of [...pts.thumb, ...pts.fingers.flat()]) expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
  });

  it('chaque leçon a une animation et une vérification', () => {
    for (const lesson of LESSONS) {
      expect(typeof lesson.check).toBe('function');
      expect(sampleLesson(lesson, 'left', 0.5) || sampleLesson(lesson, 'right', 0.5)).toBeTruthy();
    }
  });

  it('la leçon « silence » se valide quand les deux poings ont coupé le son', () => {
    const lesson = LESSONS.find((l) => l.title === 'silence');
    expect(lesson.check({ mutes: 1 }, { mutes: 0 })).toBe(true);
    expect(lesson.check({ mutes: 0 }, { mutes: 0 })).toBe(false);
  });
});
