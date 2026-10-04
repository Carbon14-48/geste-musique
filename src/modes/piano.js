// Mode piano : clavier virtuel de 8 touches dans l'air.
// La position horizontale du bout de l'index choisit la touche, une « tape » vers le bas la joue.
// V (deux doigts écartés) joue l'accord de la touche, la hauteur de la main règle l'octave.

import { LM } from '../core/landmarks.js';
import { degreeToMidi, midiToName, triad } from '../core/scale.js';
import { octaveShift } from './notes.js';

const KEYS = 8;

function keyAt(hand) {
  return Math.max(0, Math.min(KEYS - 1, Math.floor(hand.screen[LM.INDEX_TIP].x * KEYS)));
}

export default {
  id: 'piano',
  name: 'Piano (clavier dans l\'air)',
  help: [
    ['Position horizontale de l\'index', 'Choisit l\'une des 8 touches'],
    ['Tape de l\'index vers le bas', 'Joue la touche (plus vite = plus fort)'],
    ['V (deux doigts écartés)', 'Accord de la touche'],
    ['Hauteur de la main', 'Octave'],
    ['Poing', 'Relâche la pédale, coupe le son'],
  ],
  enter() {
    this.flash = new Array(KEYS).fill(0);
    this.hover = { left: null, right: null };
  },
  exit() {},
  frame(app, frame) {
    const { engine, settings } = app;
    for (const role of ['left', 'right']) {
      const hand = frame.hands[role];
      this.hover[role] = hand ? keyAt(hand) : null;
    }
    for (const e of frame.events) {
      const hand = frame.hands[e.hand];
      if (!hand) continue;
      const key = keyAt(hand);
      const base = degreeToMidi(settings.root, settings.scale, key) + octaveShift(app, hand);
      if (e.type === 'tap' && hand.fingers[1]) {
        const vel = Math.max(0.2, Math.min(1, e.speed / 14));
        engine.playNote(base, 0.6, vel);
        this.flash[key] = frame.t;
        app.hud('note', midiToName(base));
      } else if (e.type === 'pose_enter' && e.label === 'peace') {
        engine.playChord(triad(settings.root, settings.scale, key).map((m) => m + octaveShift(app, hand)), 1.2, 0.7);
        this.flash[key] = frame.t;
        app.hud('note', `Accord ${midiToName(base)}`);
      } else if (e.type === 'pose_enter' && e.label === 'fist') {
        engine.releaseAll();
      }
    }
  },
  draw(ctx, w, h, app, frame) {
    const keyW = w / KEYS;
    const top = h * 0.72;
    ctx.save();
    ctx.font = '13px system-ui';
    ctx.textAlign = 'center';
    for (let k = 0; k < KEYS; k++) {
      const lit = frame && frame.t - this.flash[k] < 180;
      const hover = this.hover.left === k || this.hover.right === k;
      ctx.fillStyle = lit ? 'rgba(255, 196, 0, 0.75)' : hover ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.15)';
      ctx.fillRect(k * keyW + 2, top, keyW - 4, h - top - 4);
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      const midi = degreeToMidi(app.settings.root, app.settings.scale, k);
      ctx.fillText(midiToName(midi), k * keyW + keyW / 2, h - 14);
    }
    ctx.restore();
  },
};
