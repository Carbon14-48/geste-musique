// Mode « Mes gestes » : les gestes appris dans l'onglet Apprendre (KNN) jouent des notes.
// Le n-ième geste appris joue le n-ième degré de la gamme.

import { GestureStabilizer } from '../core/trigger.js';
import { degreeToMidi, midiToName } from '../core/scale.js';

export default {
  id: 'custom',
  name: 'Mes gestes (appris)',
  overrides: ['like', 'dislike', 'rock', 'call', 'gun', 'combo'],
  help: [
    ['Onglet « Apprendre »', 'Enregistrer 20 à 50 exemples par geste'],
    ['Geste appris n°1, 2, 3…', 'Degré 1, 2, 3… de la gamme'],
    ['Geste « rien » (si appris)', 'Silence'],
  ],
  enter() {
    this.stab = new GestureStabilizer({ enterFrames: 4, exitFrames: 4 });
    this.current = null;
  },
  exit(app) {
    if (this.current !== null) app.engine.noteOff(this.current);
    this.current = null;
  },
  frame(app, frame) {
    const right = frame.hands.right ?? frame.hands.left;
    let label = 'none';
    if (right && app.knn.samples.length) {
      const pred = app.knn.predict(right.features);
      if (pred && pred.confidence > 0.7) label = pred.label;
      app.hud('custom', pred ? `${pred.label} (${Math.round(pred.confidence * 100)} %)` : '—');
    }
    for (const e of this.stab.update(label, frame.t)) {
      if (e.type === 'exit' && this.current !== null) {
        app.engine.noteOff(this.current);
        this.current = null;
      }
      if (e.type !== 'enter' || e.label === 'rien') continue;
      const deg = app.knn.labels.filter((l) => l !== 'rien').indexOf(e.label);
      if (deg < 0) continue;
      const midi = degreeToMidi(app.settings.root, app.settings.scale, deg);
      app.engine.noteOn(midi, 0.8);
      this.current = midi;
      app.hud('note', `${midiToName(midi)} — ${e.label}`);
    }
  },
};
