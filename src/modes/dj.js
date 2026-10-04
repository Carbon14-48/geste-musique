// Mode DJ et boucles : un séquenceur de batterie à 16 pas.
// Pouce levé = lecture, pouce baissé = arrêt, balayage main droite = motif suivant/précédent,
// hauteur main droite = filtre, hauteur main gauche = réverbération, frappes main gauche = tempo.

import * as Tone from 'tone';
import { TempoTracker } from '../core/motion.js';

export const PATTERNS = [
  { name: 'Four on the floor', kick: 'x...x...x...x...', snare: '....x.......x...', hihat: '..x...x...x...x.' },
  { name: 'Boom bap', kick: 'x.........x.....', snare: '....x.......x...', hihat: 'x.x.x.x.x.x.x.x.' },
  { name: 'Reggaeton', kick: 'x...x...x...x...', snare: '...x..x....x..x.', hihat: 'x.x.x.x.x.x.x.x.' },
  { name: 'Breakbeat', kick: 'x.........x..x..', snare: '....x..x.x..x...', hihat: 'xxxxxxxxxxxxxxxx' },
  { name: 'Rock', kick: 'x.......x.x.....', snare: '....x.......x...', hihat: 'x.x.x.x.x.x.x.x.' },
];

export default {
  id: 'dj',
  name: 'DJ et boucles',
  overrides: ['like', 'dislike', 'swipe'],
  help: [
    ['Pouce levé', 'Lancer le motif'],
    ['Pouce baissé', 'Arrêter le motif'],
    ['Balayage main droite ← →', 'Motif précédent / suivant'],
    ['Hauteur main droite', 'Filtre (brillance)'],
    ['Hauteur main gauche', 'Réverbération'],
    ['Frappes main gauche', 'Régler le tempo'],
    ['Pistolet', 'Enregistrer une couche par-dessus'],
  ],
  enter(app) {
    this.pattern = 0;
    this.step = 0;
    this.bpm = 100;
    this.tempo = new TempoTracker();
    this.clock = new Tone.Clock((time) => this.tick(app, time), (this.bpm / 60) * 4);
    app.hud('tempo', `${this.bpm} BPM`);
    app.hud('chord', PATTERNS[0].name);
  },
  exit(app) {
    this.clock?.stop();
    this.clock?.dispose();
    this.clock = null;
    app.engine.setBrightness(1);
  },
  tick(app, time) {
    const p = PATTERNS[this.pattern];
    for (const pad of ['kick', 'snare', 'hihat']) {
      if (p[pad][this.step] === 'x') app.engine.drum(pad, this.step % 4 === 0 ? 0.9 : 0.6, { time });
    }
    this.step = (this.step + 1) % 16;
  },
  frame(app, frame) {
    for (const e of frame.events) {
      if (e.type === 'pose_enter' && e.label === 'like') {
        if (this.clock.state !== 'started') this.clock.start();
        app.notify('▶ Motif lancé');
      } else if (e.type === 'pose_enter' && e.label === 'dislike') {
        this.clock.stop();
        this.step = 0;
        app.notify('■ Motif arrêté');
      } else if ((e.type === 'swipe_left' || e.type === 'swipe_right') && e.hand === 'right') {
        const n = PATTERNS.length;
        this.pattern = (this.pattern + (e.type === 'swipe_right' ? 1 : -1) + n) % n;
        app.hud('chord', PATTERNS[this.pattern].name);
        app.notify(`💿 ${PATTERNS[this.pattern].name}`);
      } else if (e.type === 'strike' && e.hand === 'left') {
        const bpm = this.tempo.tap(frame.t);
        if (bpm && bpm >= 50 && bpm <= 200) {
          this.bpm = bpm;
          this.clock.frequency.value = (bpm / 60) * 4;
          app.hud('tempo', `${bpm} BPM`);
        }
      }
    }
    const { left, right } = frame.hands;
    if (right) app.engine.setBrightness(app.normHeight(right.height));
    if (left) app.engine.setReverb(app.normHeight(left.height) * 0.8);
  },
};
