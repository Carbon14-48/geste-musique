// Mode binaire (catalogue section 2) : chaque combinaison de doigts levés = une note.
// On ne garde que les 12 combinaisons confortables et bien distinctes (RELIABLE_COMBOS).

import { RELIABLE_COMBOS } from '../core/rules.js';
import { GestureStabilizer } from '../core/trigger.js';
import { degreeToMidi, midiToName } from '../core/scale.js';
import { handleInstrumentHand } from './notes.js';

const FINGER_LETTERS = ['P', 'I', 'M', 'A', 'a'];

export function comboName(key) {
  return key
    .split('')
    .map((b, i) => (b === '1' ? FINGER_LETTERS[i] : '·'))
    .join('');
}

export default {
  id: 'binary',
  name: 'Binaire (12 combinaisons)',
  overrides: ['like', 'dislike', 'rock', 'call', 'gun'],
  help: [
    ['Main droite : combinaison de doigts', '12 notes sur deux octaves (table ci-dessous)'],
    ['Main droite : poing', 'STOP'],
    ['Main gauche : 1 à 5 doigts tenus', 'Instrument'],
    ...RELIABLE_COMBOS.map((k, i) => [comboName(k), `degré ${i + 1}`]),
  ],
  enter() {
    this.stab = new GestureStabilizer({ enterFrames: 4, exitFrames: 4, idle: '-' });
    this.current = null;
  },
  exit(app) {
    if (this.current !== null) app.engine.noteOff(this.current);
    this.current = null;
  },
  frame(app, frame) {
    handleInstrumentHand(app, frame);
    const right = frame.hands.right;
    const key = right ? right.fingers.map((f) => (f ? 1 : 0)).join('') : '-';
    for (const e of this.stab.update(key, frame.t)) {
      if (e.type === 'exit' && this.current !== null) {
        app.engine.noteOff(this.current);
        this.current = null;
      }
      if (e.type !== 'enter') continue;
      if (e.label === '00000') {
        app.engine.stopAll();
        app.hud('note', 'STOP');
        continue;
      }
      const deg = RELIABLE_COMBOS.indexOf(e.label);
      if (deg < 0) continue;
      const midi = degreeToMidi(app.settings.root, app.settings.scale, deg);
      app.engine.noteOn(midi, 0.8);
      this.current = midi;
      app.hud('note', `${midiToName(midi)} (${comboName(e.label)})`);
    }
  },
};
