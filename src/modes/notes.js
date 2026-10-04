// Mode « Notes » : la version de base du catalogue.
// Main droite : 1 à 5 doigts = Do Ré Mi Sol La (gamme pentatonique), poing = STOP,
// hauteur de la main = octave, inclinaison = vibrato. Main gauche : nombre de doigts tenu = instrument.

import { degreeToMidi, midiToName } from '../core/scale.js';
import { INSTRUMENTS } from '../audio/engine.js';

// Poses « de comptage » : le pouce seul (pouce levé) reste réservé au volume.
export const DEGREE = { one: 0, two: 1, peace: 1, three: 2, four: 3, palm: 4, open: 4 };

export function octaveShift(app, hand) {
  const h = app.normHeight(hand.height);
  return h < 0.33 ? -12 : h > 0.66 ? 12 : 0;
}

/** Instrument choisi par la main gauche (1 à 5 doigts tenus ~0,5 s). */
export function handleInstrumentHand(app, frame) {
  for (const e of frame.events) {
    if (e.hand === 'left' && e.type === 'pose_hold' && DEGREE[e.label] !== undefined) {
      const name = Object.keys(INSTRUMENTS)[DEGREE[e.label]];
      if (name && name !== app.engine.instrument) {
        app.engine.setInstrument(name);
        app.notify(`🎹 ${INSTRUMENTS[name]}`);
        app.refreshControls();
      }
    }
  }
}

export default {
  id: 'notes',
  name: 'Notes (version de base)',
  help: [
    ['Main droite : 1 à 5 doigts', 'Do, Ré, Mi, Sol, La (tenue tant que la pose reste)'],
    ['Main droite : poing', 'STOP'],
    ['Hauteur de la main droite', 'Octave grave / médium / aigu'],
    ['Inclinaison de la main droite', 'Vibrato'],
    ['Main gauche : 1 à 5 doigts tenus', 'Piano, guitare, synthé, orgue, cloches'],
  ],
  enter(app) {
    this.current = null;
  },
  exit(app) {
    if (this.current !== null) app.engine.noteOff(this.current);
    this.current = null;
  },
  frame(app, frame) {
    const { engine, settings } = app;
    handleInstrumentHand(app, frame);
    for (const e of frame.events) {
      if (e.hand !== 'right') continue;
      if (e.type === 'pose_enter') {
        if (e.label === 'fist') {
          engine.stopAll();
          this.current = null;
          app.hud('note', 'STOP');
          continue;
        }
        const deg = DEGREE[e.label];
        if (deg === undefined) continue;
        if (this.current !== null) engine.noteOff(this.current);
        const midi = degreeToMidi(settings.root, settings.scale, deg) + octaveShift(app, frame.hands.right ?? { height: 0.5 });
        engine.noteOn(midi, 0.8);
        this.current = midi;
        app.hud('note', midiToName(midi));
      } else if (e.type === 'pose_exit' && this.current !== null && DEGREE[e.label] !== undefined) {
        engine.noteOff(this.current);
        this.current = null;
      }
    }
    const right = frame.hands.right;
    if (right) engine.setVibrato(Math.max(0, (Math.abs(right.tilt) - 15) / 40));
  },
};
