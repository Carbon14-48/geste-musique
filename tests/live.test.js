import { describe, it, expect } from 'vitest';
import { buildChord, chordName, romanName, spiceBand, voice, diffNotes } from '../src/live/theory.js';
import { drumBar, bassStep } from '../src/live/patterns.js';
import { PinchTracker } from '../src/live/pinch.js';
import { ArcSelector } from '../src/live/arc.js';
import { ChordHand } from '../src/live/chordHand.js';
import { laneNote, createModes } from '../src/live/rightModes.js';
import { classifyPose, palmFacingCamera } from '../src/core/rules.js';
import { synthHand, U, D } from './helpers/synthHand.js';
import { Plate } from '../src/live/plate.js';
import { fakeCtx } from './helpers/fakeCanvas.js';

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
  it('dépend de la vraie main du musicien (image brute)', () => {
    const { image } = synthHand([U, U, U, U, U]); // pouce à gauche de l'image brute
    expect(palmFacingCamera(image, 'left')).toBe(true); // main gauche, paume vers la caméra
    expect(palmFacingCamera(image, 'right')).toBe(false); // main droite vue de dos
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

import { InstrumentWheel } from '../src/live/wheel.js';
import { MuteDetector, isTightFist } from '../src/live/mute.js';
import { HandTracker } from '../src/core/handTracker.js';
import { openness } from '../src/core/rules.js';
import { BrowserPoseModel } from '../src/ml/trainer.js';
import { normalizePose } from '../src/core/landmarks.js';
import * as tf from '@tensorflow/tfjs';
import { H } from './helpers/synthHand.js';

describe('rôles des mains', () => {
  it('l\'étiquette MediaPipe donne directement la main, le réglage « inverser » l\'échange', () => {
    const tr = new HandTracker();
    expect(tr.roleFromLabel('Left')).toBe('left');
    expect(tr.roleFromLabel('Right')).toBe('right');
    tr.swapHands = true;
    expect(tr.roleFromLabel('Left')).toBe('right');
  });
});

describe('roue d\'instruments', () => {
  const lh = (label, tilt = 0) => ({ label, tilt, palm: { x: 0.3, y: 0.5 } });

  it('poing tenu -> ouverte, rotation -> instrument suivant, main ouverte -> choix', () => {
    const w = new InstrumentWheel({ count: 14, summonFrames: 3, stepDeg: 10 });
    let ev;
    for (let i = 0; i < 3; i++) ev = w.update(lh('fist', 5), 2, i * 33);
    expect(ev.type).toBe('opened');
    expect(w.hover).toBe(2);
    w.update(lh('fist', 26), 2, 120); // +21° = 2 crans
    expect(w.hover).toBe(4);
    w.update(lh('fist', 29), 2, 150); // hystérésis : on reste sur le cran
    expect(w.hover).toBe(4);
    expect(w.update(lh('palm', 26), 2, 200)).toEqual({ type: 'selected', index: 4 });
  });

  it('tourne en boucle dans la liste', () => {
    const w = new InstrumentWheel({ count: 14, summonFrames: 1, stepDeg: 10 });
    w.update(lh('fist', 0), 0, 0);
    w.update(lh('fist', -10), 0, 30);
    expect(w.hover).toBe(13);
  });

  it('ne s\'ouvre pas si l\'autre main est aussi un poing (silence), s\'annule si la main disparaît', () => {
    const w = new InstrumentWheel({ count: 14, summonFrames: 1 });
    expect(w.update(lh('fist'), 0, 0, true).type).toBe(null);
    w.update(lh('open'), 0, 10);
    expect(w.update(lh('fist'), 0, 20).type).toBe('opened');
    expect(w.update(null, 0, 1000).type).toBe('cancelled');
  });
});

describe('silence strict', () => {
  const hand = (states) => {
    const { world, image } = synthHand(states);
    const p = classifyPose(world, image);
    return { rawLabel: p.label, fingers: p.fingers, openness: openness(world) };
  };
  const fist = hand([D, D, D, D, D]);
  const halfFist = hand([D, H, D, D, D]); // un doigt à moitié replié : encore « fist » pour les règles

  it('un poing franc compte, une main à moitié fermée non', () => {
    expect(halfFist.rawLabel).toBe('fist');
    expect(isTightFist(fist)).toBe(true);
    expect(isTightFist(halfFist)).toBe(false);
  });

  it('un poing + une main à moitié fermée ne coupent jamais le son', () => {
    const m = new MuteDetector();
    for (let i = 0; i < 30; i++) expect(m.update(fist, halfFist).muted).toBe(false);
  });

  it('deux poings tenus 8 images coupent le son, une main ouverte 4 images le rend', () => {
    const m = new MuteDetector();
    for (let i = 0; i < 7; i++) expect(m.update(fist, fist).muted).toBe(false);
    expect(m.update(fist, fist)).toEqual({ muted: true, changed: true });
    const open = hand([U, U, U, U, U]);
    for (let i = 0; i < 3; i++) expect(m.update(fist, open).muted).toBe(true);
    expect(m.update(fist, open)).toEqual({ muted: false, changed: true });
  });

  it('une image ratée au milieu remet le compteur à zéro', () => {
    const m = new MuteDetector();
    for (let i = 0; i < 6; i++) m.update(fist, fist);
    m.update(fist, halfFist);
    for (let i = 0; i < 7; i++) expect(m.update(fist, fist).muted).toBe(false);
  });
});

function fakeAudio() {
  const calls = [];
  return {
    calls,
    drumLevels: [0, 0, 0, 0],
    bassParams: null,
    setDrumCutoff: (v) => calls.push(['cutoff', v]),
    setBassResonance: (v) => calls.push(['resonance', v]),
    leadOn: (f, n) => calls.push(['leadOn', f, n]),
    leadOff: (f) => calls.push(['leadOff', f]),
    setLeadFilter: (v) => calls.push(['leadFilter', v]),
    setFx: (f, v, on) => calls.push(['fx', f, v, on]),
    setArp: (v) => calls.push(['arp', v]),
    setEnvelope: (v) => calls.push(['envelope', v]),
    setTremolo: (v) => calls.push(['tremolo', v]),
    setGrit: (v) => calls.push(['grit', v]),
  };
}

describe('les 5 modes de la main droite (arc)', () => {
  it('batterie : la rotation du poignet règle le niveau du pad tenu', () => {
    const audio = fakeAudio();
    const modes = createModes(audio, {});
    modes.drums.hold(1, { roll: 0.5 });
    expect(modes.drums.levels[1]).toBe(2);
    expect(audio.drumLevels[1]).toBe(2);
    expect(modes.drums.readout(1)).toContain('caisse claire');
  });

  it('basse : les 4 pincements règlent densité, notes, octave et groove', () => {
    const audio = fakeAudio();
    const modes = createModes(audio, {});
    modes.bass.hold(0, { roll: 0.8 });
    expect(audio.bassParams.density).toBe(0.8);
  });

  it('mélodie : la hauteur choisit la note tenue par le doigt pincé', () => {
    const audio = fakeAudio();
    const modes = createModes(audio, {});
    modes.melody.key = A_MINOR;
    modes.melody.hold(1, { roll: 0.2 }, 0.5);
    const lane = Math.floor(0.5 * 12);
    expect(audio.calls).toContainEqual(['leadOn', 1, laneNote(A_MINOR, lane, 1)]);
    modes.melody.release(1);
    expect(audio.calls).toContainEqual(['leadOff', 1]);
    expect(modes.melody.lanes[1]).toBeNull();
  });

  it('fx : actif seulement tant que le doigt est pincé, revient à 0 au relâché', () => {
    const audio = fakeAudio();
    const modes = createModes(audio, {});
    modes.fx.hold(2, { roll: 0.6 });
    expect(modes.fx.active[2]).toBe(true);
    expect(audio.calls).toContainEqual(['fx', 2, 0.6, true]);
    modes.fx.release(2);
    expect(modes.fx.active[2]).toBe(false);
    expect(audio.calls).toContainEqual(['fx', 2, 0, false]);
  });

  it('sculpt : chaque doigt pilote un paramètre, en dessous de 0,08 la valeur tombe à 0', () => {
    const audio = fakeAudio();
    const modes = createModes(audio, {});
    modes.sculpt.hold(0, { roll: 0.5 });
    expect(audio.calls).toContainEqual(['arp', 0.5]);
    modes.sculpt.hold(1, { roll: 0.05 });
    expect(audio.calls).toContainEqual(['envelope', 0]);
    modes.sculpt.hold(2, { roll: 0.3 });
    modes.sculpt.hold(3, { roll: 0.4 });
    expect(audio.calls).toContainEqual(['tremolo', 0.3]);
    expect(audio.calls).toContainEqual(['grit', 0.4]);
  });

  it('sculpt : la hauteur de la main (idle) règle l\'ouverture du voicing', () => {
    const audio = fakeAudio();
    const chordHand = { spread: 0 };
    const modes = createModes(audio, chordHand);
    modes.sculpt.idle({ roll: 0 }, 0.7);
    expect(modes.sculpt.spread).toBe(0.7);
    expect(chordHand.spread).toBe(0.7);
    expect(modes.sculpt.readout(null)).toContain('70');
  });
});

describe('entraînement TensorFlow.js dans le navigateur', () => {
  it('apprend des poses synthétiques', async () => {
    const shapes = { fist: [D, D, D, D, D], one: [D, U, D, D, D], palm: [U, U, U, U, U], rock: [D, U, D, D, U] };
    const samples = [];
    for (const [label, st] of Object.entries(shapes)) {
      for (let i = 0; i < 25; i++) {
        const { world } = synthHand(st, { rotateDeg: (i - 12) * 2 });
        const jitter = world.map((p) => ({ x: p.x + (Math.random() - 0.5) * 0.004, y: p.y + (Math.random() - 0.5) * 0.004, z: p.z }));
        samples.push({ label, x: normalizePose(jitter, 'Right') });
      }
    }
    const model = await BrowserPoseModel.train(samples, { epochs: 60 });
    let ok = 0;
    for (const [label, st] of Object.entries(shapes)) {
      const { world } = synthHand(st, { rotateDeg: 7 });
      if (model.predict(normalizePose(world, 'Right')).label === label) ok++;
    }
    expect(ok / 4).toBeGreaterThanOrEqual(0.9);
  }, 30000);

  it('plusieurs ré-entraînements de suite (mode apprentissage) ne fuient pas de mémoire', async () => {
    const samples = [];
    for (const [label, st] of Object.entries({ fist: [D, D, D, D, D], palm: [U, U, U, U, U] })) {
      for (let i = 0; i < 10; i++) {
        const { world } = synthHand(st, { rotateDeg: i });
        samples.push({ label, x: normalizePose(world, 'Right') });
      }
    }
    const before = tf.memory().numTensors;
    let model = null;
    for (let i = 0; i < 3; i++) {
      const next = await BrowserPoseModel.train(samples, { epochs: 5 });
      model?.dispose(); // simule useModel() : l'ancien modèle est libéré avant d'adopter le nouveau
      model = next;
    }
    model.dispose();
    expect(tf.memory().numTensors).toBe(before);
  }, 30000);
});

function fakeHand(role) {
  return {
    role,
    label: 'palm',
    count: 5,
    height: 0.5,
    roll: 0.5,
    pinch: 0.1,
    palmFacing: true,
    pointsDown: false,
    screen: Array.from({ length: 21 }, (_, i) => ({ x: 0.4 + i * 0.01, y: 0.5 + i * 0.005 })),
    fingers: [true, true, true, true, true],
  };
}

describe('Plate.render (Geste Live) : le canvas se dessine sans erreur dans chaque état', () => {
  const key = { root: 9, mode: 'minor' };
  const baseState = () => ({
    video: null,
    mirror: true,
    scrim: 0.25,
    started: true,
    hands: { left: null, right: null },
    chord: null,
    keyName: 'La mineur',
    bpm: 100,
    recording: false,
    recordingTime: '00:00',
    mode: null,
    modeState: null,
    pinchFinger: null,
    arc: { open: false, hover: null, anchor: { x: 0.7, y: 0.6 } },
    wheel: { open: false, hover: 0, anchor: { x: 0.3, y: 0.6 }, items: INSTRUMENTS },
    step: 0,
    bar: 0,
    leftHeight: 0.5,
    rightHeight: 0.5,
    leftRoll: 0.5,
    rightRoll: 0.5,
    instrument: 'piano',
    muted: false,
  });

  it('aucune main (écran de démarrage)', () => {
    const plate = new Plate();
    expect(() => plate.render(fakeCtx(), 1280, 720, baseState())).not.toThrow();
  });

  it('avant de démarrer (écran d\'accueil, ondes + taches animées)', () => {
    const plate = new Plate();
    const s = { ...baseState(), started: false };
    expect(() => plate.render(fakeCtx(), 1280, 720, s)).not.toThrow();
  });

  it('accord actif (main gauche)', () => {
    const plate = new Plate();
    const chordHand = new ChordHand({ setChord: () => {}, releaseChord: () => {}, nextEighth: () => 0, ready: false, setPadTone: () => {} });
    let chord;
    for (let i = 0; i < 4; i++) chord = chordHand.update(fakeHand('left'), key, 0.5, i * 33);
    const s = { ...baseState(), hands: { left: fakeHand('left'), right: null }, chord };
    expect(() => plate.render(fakeCtx(), 1280, 720, s)).not.toThrow();
  });

  it('arc ouvert (choix du mode, main droite)', () => {
    const plate = new Plate();
    const s = { ...baseState(), hands: { left: null, right: fakeHand('right') }, arc: { open: true, hover: 1, anchor: { x: 0.7, y: 0.6 } } };
    expect(() => plate.render(fakeCtx(), 1280, 720, s)).not.toThrow();
  });

  it('roue d\'instruments ouverte (main gauche)', () => {
    const plate = new Plate();
    const s = { ...baseState(), hands: { left: fakeHand('left'), right: null }, wheel: { open: true, hover: 2, anchor: { x: 0.3, y: 0.6 }, items: INSTRUMENTS } };
    expect(() => plate.render(fakeCtx(), 1280, 720, s)).not.toThrow();
  });

  for (const mode of ['drums', 'bass', 'melody', 'fx', 'sculpt']) {
    it(`mode "${mode}" actif avec un doigt pincé`, () => {
      const plate = new Plate();
      const modes = createModes(
        { drumLevels: [0, 0, 0, 0], setDrumCutoff() {}, bassParams: null, setBassResonance() {}, leadOn() {}, leadOff() {}, setLeadFilter() {}, setFx() {}, setArp() {}, setEnvelope() {}, setTremolo() {}, setGrit() {} },
        { spread: 0 },
      );
      modes.melody.key = key;
      modes[mode].hold(0, { roll: 0.6 }, 0.5);
      const s = { ...baseState(), mode, modeState: modes[mode], pinchFinger: 0, hands: { left: null, right: fakeHand('right') } };
      expect(() => plate.render(fakeCtx(), 1280, 720, s)).not.toThrow();
    });
  }

  it('silence (deux poings)', () => {
    const plate = new Plate();
    const s = { ...baseState(), muted: true };
    expect(() => plate.render(fakeCtx(), 1280, 720, s)).not.toThrow();
  });

  it('enregistrement en cours', () => {
    const plate = new Plate();
    const s = { ...baseState(), recording: true, recordingTime: '00:12' };
    expect(() => plate.render(fakeCtx(), 1280, 720, s)).not.toThrow();
  });

  it('écran vertical (portrait, mobile)', () => {
    const plate = new Plate();
    const s = { ...baseState(), hands: { left: fakeHand('left'), right: fakeHand('right') } };
    expect(() => plate.render(fakeCtx(), 390, 844, s)).not.toThrow();
  });
});
