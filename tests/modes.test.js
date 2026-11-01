import { describe, it, expect, beforeEach } from 'vitest';
import notes from '../src/modes/notes.js';
import guitar from '../src/modes/guitar.js';
import drums from '../src/modes/drums.js';
import binary from '../src/modes/binary.js';
import theremin from '../src/modes/theremin.js';
import piano from '../src/modes/piano.js';
import dj, { PATTERNS } from '../src/modes/dj.js';
import custom from '../src/modes/custom.js';
import { GlobalGestures } from '../src/modes/global.js';
import { GUITAR_CHORDS, degreeToMidi } from '../src/core/scale.js';
import { LM } from '../src/core/landmarks.js';
import { Overlay } from '../src/ui/overlay.js';
import { fakeCanvas } from './helpers/fakeCanvas.js';

// Overlay.resize() lit window.devicePixelRatio ; il n'y a pas de DOM en environnement de test.
if (typeof window === 'undefined') globalThis.window = { devicePixelRatio: 1 };

function fakeApp(mode) {
  const calls = [];
  const engine = {
    instrument: 'piano',
    volume: 0.5,
    distortionOn: false,
    wahOn: false,
    noteOn: (n, v) => calls.push(['noteOn', n]),
    noteOff: (n) => calls.push(['noteOff', n]),
    playNote: (n) => calls.push(['playNote', n]),
    playChord: (ns) => calls.push(['playChord', ns]),
    strum: (ns, dir, v) => calls.push(['strum', ns, dir]),
    drum: (pad, v) => calls.push(['drum', pad]),
    stopAll: () => calls.push(['stopAll']),
    releaseAll: () => calls.push(['releaseAll']),
    setInstrument: (n) => { engine.instrument = n; calls.push(['setInstrument', n]); },
    cycleInstrument: () => 'synth',
    volumeStep(d) { this.volume += d; calls.push(['volume', d]); return this.volume; },
    setDistortion(on) { this.distortionOn = on; calls.push(['distortion', on]); return on; },
    setWah(on) { this.wahOn = on; return on; },
    setVibrato: () => {},
    thereminOff: () => calls.push(['thereminOff']),
    thereminSet: (midi, level) => calls.push(['thereminSet', midi, level]),
    setBrightness: (v) => calls.push(['brightness', v]),
    setReverb: (v) => calls.push(['reverb', v]),
  };
  const looper = { toggleRecord: () => calls.push(['loop']), status: () => '', stop: () => calls.push(['loopStop']), undo: () => {} };
  return {
    calls,
    engine,
    looper,
    mode,
    locked: false,
    settings: { root: 60, scale: 'pentatonique' },
    notify: (m) => calls.push(['notify', m]),
    hud: (k, v) => calls.push(['hud', k, v]),
    refreshControls: () => {},
    normHeight: (h) => h,
    knn: { samples: [], labels: [], predict: () => null },
  };
}

const hand = (extra = {}) => ({ label: 'none', height: 0.5, fingers: [false, false, false, false, false], palm: { x: 0.5, y: 0.8 }, tilt: 0, ...extra });
const frame = (events, hands = {}, t = 0) => ({ t, events: events.map((e) => ({ t, ...e })), hands: { left: null, right: null, ...hands } });

describe('mode Notes', () => {
  let app;
  beforeEach(() => {
    app = fakeApp(notes);
    notes.enter(app);
  });

  it('1 à 5 doigts de la main droite jouent Do Ré Mi Sol La, tenus jusqu\'à la sortie', () => {
    notes.frame(app, frame([{ type: 'pose_enter', label: 'three', hand: 'right' }], { right: hand() }));
    expect(app.calls).toContainEqual(['noteOn', 64]);
    notes.frame(app, frame([{ type: 'pose_exit', label: 'three', hand: 'right' }], { right: hand() }));
    expect(app.calls).toContainEqual(['noteOff', 64]);
  });

  it('la hauteur de la main change l\'octave', () => {
    notes.frame(app, frame([{ type: 'pose_enter', label: 'one', hand: 'right' }], { right: hand({ height: 0.9 }) }));
    expect(app.calls).toContainEqual(['noteOn', 72]);
  });

  it('le poing coupe tout', () => {
    notes.frame(app, frame([{ type: 'pose_enter', label: 'fist', hand: 'right' }], { right: hand() }));
    expect(app.calls).toContainEqual(['stopAll']);
  });

  it('la main gauche tenue choisit l\'instrument', () => {
    notes.frame(app, frame([{ type: 'pose_hold', label: 'two', hand: 'left' }], { left: hand() }));
    expect(app.engine.instrument).toBe('guitar');
  });
});

describe('mode Guitare', () => {
  it('la main gauche choisit l\'accord, la droite gratte', () => {
    const app = fakeApp(guitar);
    guitar.enter(app);
    guitar.frame(app, frame([{ type: 'strum', dir: 'down', speed: 10, hand: 'right' }], { left: hand({ label: 'three' }), right: hand({ label: 'open' }) }));
    expect(app.calls).toContainEqual(['strum', GUITAR_CHORDS[3].notes, 'down']);
  });
});

describe('mode Batterie', () => {
  it('une frappe dans le 2e pad joue la caisse claire', () => {
    const app = fakeApp(drums);
    drums.enter(app);
    drums.frame(app, frame([{ type: 'strike', speed: 12, hand: 'right' }], { right: hand({ palm: { x: 0.3, y: 0.8 } }) }));
    expect(app.calls).toContainEqual(['drum', 'snare']);
  });

  it('une frappe trop haute ne joue rien', () => {
    const app = fakeApp(drums);
    drums.enter(app);
    drums.frame(app, frame([{ type: 'strike', speed: 12, hand: 'right' }], { right: hand({ palm: { x: 0.3, y: 0.2 } }) }));
    expect(app.calls.filter((c) => c[0] === 'drum')).toEqual([]);
  });
});

describe('mode Binaire', () => {
  it('une combinaison fiable stable joue une note', () => {
    const app = fakeApp(binary);
    binary.enter(app);
    for (let i = 0; i < 5; i++) {
      binary.frame(app, frame([], { right: hand({ fingers: [false, true, true, false, false] }) }, i * 33));
    }
    expect(app.calls).toContainEqual(['noteOn', 62]);
  });
});

describe('gestes globaux', () => {
  it('pouce levé monte le volume, rock active la distorsion', () => {
    const app = fakeApp(notes);
    const g = new GlobalGestures(app);
    g.handle(frame([{ type: 'pose_enter', label: 'like', hand: 'right' }]));
    g.handle(frame([{ type: 'pose_enter', label: 'rock', hand: 'left' }]));
    expect(app.calls).toContainEqual(['volume', 0.1]);
    expect(app.engine.distortionOn).toBe(true);
  });

  it('deux poings = silence total', () => {
    const app = fakeApp(notes);
    const g = new GlobalGestures(app);
    g.handle(frame([{ type: 'pose_enter', label: 'fist', hand: 'right' }], { left: hand({ label: 'fist' }), right: hand({ label: 'fist' }) }));
    expect(app.calls).toContainEqual(['stopAll']);
  });

  it('OK tenu verrouille le jeu et bloque les autres gestes', () => {
    const app = fakeApp(notes);
    const g = new GlobalGestures(app);
    expect(g.handle(frame([{ type: 'pose_hold', label: 'ok', hand: 'right' }]))).toBe(false);
    expect(app.locked).toBe(true);
    g.handle(frame([{ type: 'pose_enter', label: 'like', hand: 'right' }]));
    expect(app.calls.filter((c) => c[0] === 'volume')).toEqual([]);
  });

  it('un mode peut reprendre un geste global (overrides)', () => {
    const app = fakeApp(guitar);
    const g = new GlobalGestures(app);
    g.handle(frame([{ type: 'pose_enter', label: 'like', hand: 'right' }]));
    expect(app.calls.filter((c) => c[0] === 'volume')).toEqual([]);
  });
});

describe('mode Thérémine', () => {
  it('la hauteur de la main droite règle une note continue', () => {
    const app = fakeApp(theremin);
    theremin.enter(app);
    theremin.frame(app, frame([], { right: hand({ height: 0.5 }), left: hand({ height: 0.9 }) }));
    expect(app.calls.some((c) => c[0] === 'thereminSet')).toBe(true);
  });

  it('un poing (main droite ou gauche) coupe le son', () => {
    const app = fakeApp(theremin);
    theremin.enter(app);
    theremin.frame(app, frame([], { right: hand({ label: 'fist' }) }));
    expect(app.calls).toContainEqual(['thereminOff']);
  });

  it('sortir du mode coupe le son', () => {
    const app = fakeApp(theremin);
    theremin.enter(app);
    theremin.exit(app);
    expect(app.calls).toContainEqual(['thereminOff']);
  });
});

describe('mode Piano (clavier dans l\'air)', () => {
  it('une tape sur l\'index joue la touche visée', () => {
    const app = fakeApp(piano);
    piano.enter(app);
    const screen = Array(21).fill({ x: 0, y: 0 });
    screen[LM.INDEX_TIP] = { x: 0.3, y: 0.5 };
    const right = hand({ fingers: [false, true, false, false, false], screen, height: 0.5 });
    piano.frame(app, frame([{ type: 'tap', hand: 'right', speed: 10 }], { right }));
    const key = Math.floor(0.3 * 8);
    const expected = degreeToMidi(app.settings.root, app.settings.scale, key);
    expect(app.calls).toContainEqual(['playNote', expected]);
  });

  it('un poing relâche tout', () => {
    const app = fakeApp(piano);
    piano.enter(app);
    const right = hand({ label: 'fist', screen: Array(21).fill({ x: 0, y: 0 }) });
    piano.frame(app, frame([{ type: 'pose_enter', label: 'fist', hand: 'right' }], { right }));
    expect(app.calls).toContainEqual(['releaseAll']);
  });
});

describe('mode DJ et boucles', () => {
  function djApp() {
    const app = fakeApp(dj);
    dj.pattern = 0;
    dj.step = 0;
    dj.bpm = 100;
    dj.tempo = { tap: () => null };
    dj.clock = {
      state: 'stopped',
      start() { this.state = 'started'; },
      stop() { this.state = 'stopped'; },
      frequency: { value: 0 },
    };
    return app;
  }

  it('pouce levé lance le motif, pouce baissé l\'arrête', () => {
    const app = djApp();
    dj.frame(app, frame([{ type: 'pose_enter', label: 'like', hand: 'right' }]));
    expect(dj.clock.state).toBe('started');
    dj.frame(app, frame([{ type: 'pose_enter', label: 'dislike', hand: 'right' }]));
    expect(dj.clock.state).toBe('stopped');
  });

  it('un balayage de la main droite change de motif', () => {
    const app = djApp();
    dj.frame(app, frame([{ type: 'swipe_right', hand: 'right' }]));
    expect(dj.pattern).toBe(1);
    expect(app.calls).toContainEqual(['hud', 'chord', PATTERNS[1].name]);
  });
});

describe('mode Mes gestes (appris)', () => {
  it('un geste appris stable joue le degré correspondant', () => {
    const app = fakeApp(custom);
    app.knn = {
      samples: [1],
      labels: ['rien', 'griffe', 'poing_leve'],
      predict: () => ({ label: 'griffe', confidence: 0.9 }),
    };
    custom.enter(app);
    for (let i = 0; i < 5; i++) {
      custom.frame(app, frame([], { right: hand() }, i * 33));
    }
    const expected = degreeToMidi(app.settings.root, app.settings.scale, 0); // « griffe » : 1er geste hors « rien »
    expect(app.calls).toContainEqual(['noteOn', expected]);
  });

  it('sans geste appris (confiance nulle), rien ne joue', () => {
    const app = fakeApp(custom);
    app.knn = { samples: [], labels: [], predict: () => null };
    custom.enter(app);
    for (let i = 0; i < 5; i++) {
      custom.frame(app, frame([], { right: hand() }, i * 33));
    }
    expect(app.calls.filter((c) => c[0] === 'noteOn')).toEqual([]);
  });
});

describe('Overlay.draw (Studio) : le canvas se dessine sans erreur dans chaque état', () => {
  const skeletonHand = (role) => hand({ role, screen: Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5 })) });

  it('aucune main', () => {
    const overlay = new Overlay(fakeCanvas());
    expect(() => overlay.draw(frame([], {}), notes, fakeApp(notes))).not.toThrow();
  });

  it('jeu verrouillé', () => {
    const overlay = new Overlay(fakeCanvas());
    const app = fakeApp(notes);
    app.locked = true;
    expect(() => overlay.draw(frame([], { right: skeletonHand('right') }), notes, app)).not.toThrow();
  });

  it('mode batterie (pads dessinés)', () => {
    const overlay = new Overlay(fakeCanvas());
    const app = fakeApp(drums);
    drums.enter(app);
    expect(() => overlay.draw(frame([], { right: skeletonHand('right') }, 100), drums, app)).not.toThrow();
  });

  it('mode piano (clavier dessiné)', () => {
    const overlay = new Overlay(fakeCanvas());
    const app = fakeApp(piano);
    piano.enter(app);
    expect(() => overlay.draw(frame([], { left: skeletonHand('left'), right: skeletonHand('right') }, 100), piano, app)).not.toThrow();
  });

  it('mode thérémine (lignes dessinées)', () => {
    const overlay = new Overlay(fakeCanvas());
    const app = fakeApp(theremin);
    theremin.enter(app);
    expect(() => overlay.draw(frame([], { right: skeletonHand('right') }), theremin, app)).not.toThrow();
  });

  it('les deux mains, squelette masqué', () => {
    const overlay = new Overlay(fakeCanvas());
    overlay.showSkeleton = false;
    expect(() => overlay.draw(frame([], { left: skeletonHand('left'), right: skeletonHand('right') }), binary, fakeApp(binary))).not.toThrow();
  });
});
