import { describe, it, expect, beforeEach } from 'vitest';
import notes from '../src/modes/notes.js';
import guitar from '../src/modes/guitar.js';
import drums from '../src/modes/drums.js';
import binary from '../src/modes/binary.js';
import { GlobalGestures } from '../src/modes/global.js';
import { GUITAR_CHORDS } from '../src/core/scale.js';

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
  };
  const looper = { toggleRecord: () => calls.push(['loop']), status: () => '', stop: () => calls.push(['loopStop']), undo: () => {} };
  return {
    calls,
    engine,
    looper,
    mode,
    locked: false,
    settings: { root: 60, scale: 'pentatonique' },
    notify: () => {},
    hud: () => {},
    refreshControls: () => {},
    normHeight: (h) => h,
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
