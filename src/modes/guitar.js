// Mode guitare : la main gauche choisit l'accord (1 = Do, 2 = Sol, 3 = La m, 4 = Fa, 5 = Mi m),
// la main droite gratte vers le bas ou le haut, la vitesse règle l'intensité,
// le poing droit étouffe les cordes (palm mute).

import { GUITAR_CHORDS } from '../core/scale.js';
import { DEGREE } from './notes.js';

export default {
  id: 'guitar',
  name: 'Guitare',
  overrides: ['swipe', 'fists', 'like', 'dislike'],
  help: [
    ['Main gauche : 1 à 5 doigts', 'Accord Do, Sol, La m, Fa, Mi m'],
    ['Main droite : balayage vertical', 'Gratter vers le bas / le haut'],
    ['Vitesse du grattage', 'Intensité'],
    ['Main droite : poing', 'Étouffer les cordes'],
  ],
  enter(app) {
    this.previousInstrument = app.engine.instrument;
    app.engine.setInstrument('guitar');
    app.refreshControls();
    this.chord = 1;
  },
  exit(app) {
    app.engine.setInstrument(this.previousInstrument ?? 'piano');
    app.refreshControls();
  },
  frame(app, frame) {
    const { engine } = app;
    const left = frame.hands.left;
    if (left && DEGREE[left.label] !== undefined) this.chord = DEGREE[left.label] + 1;
    const chord = GUITAR_CHORDS[this.chord];
    app.hud('chord', chord.name);
    for (const e of frame.events) {
      if (e.hand !== 'right') continue;
      if (e.type === 'strum' && frame.hands.right?.label !== 'fist') {
        const vel = Math.max(0.25, Math.min(1, e.speed / 14));
        engine.strum(chord.notes, e.dir, vel);
        app.hud('note', `${chord.name} ${e.dir === 'down' ? '↓' : '↑'}`);
      } else if (e.type === 'pose_enter' && e.label === 'fist') {
        engine.releaseAll();
        app.hud('note', 'étouffé');
      }
    }
  },
};
