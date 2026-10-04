// Gestes valables dans tous les modes (feuille de route, étape 2).
// Un mode peut en reprendre certains à son compte avec `overrides`.

import { ComboDetector } from '../core/trigger.js';
import { triad } from '../core/scale.js';

const comboLabel = (l) => (l === 'palm' || l === 'open' ? 'open' : l === 'peace' ? 'two' : l);

export const GLOBAL_HELP = [
  ['OK tenu 1 s', 'Verrouiller / déverrouiller le jeu'],
  ['Deux poings', 'Silence total et arrêt des boucles'],
  ['Pouce levé / baissé', 'Volume + / −'],
  ['Rock', 'Distorsion on/off'],
  ['Appel (pouce + auriculaire)', 'Effet wah on/off'],
  ['Pistolet', 'Enregistrer une couche de boucle'],
  ['Pistolet deux fois', 'Annuler la dernière couche'],
  ['Balayage main gauche ← →', 'Instrument précédent / suivant'],
  ['Poing → main ouverte → 2 doigts', 'Combo : riff'],
];

export class GlobalGestures {
  constructor(app) {
    this.app = app;
    this.combo = new ComboDetector(['fist', 'open', 'two'], { stepMs: 1200 });
  }

  /** @returns {boolean} faux si le jeu est verrouillé (les modes ne reçoivent rien) */
  handle(frame) {
    const { app } = this;
    const { engine, looper } = app;
    const skip = new Set(app.mode.overrides ?? []);

    for (const e of frame.events) {
      if (e.type === 'pose_hold' && e.label === 'ok') {
        app.locked = !app.locked;
        if (app.locked) engine.releaseAll();
        app.notify(app.locked ? '🔒 Jeu verrouillé (OK tenu pour reprendre)' : '🔓 Jeu déverrouillé');
      }
    }
    if (app.locked) return false;

    for (const e of frame.events) {
      if (e.type === 'pose_enter') {
        const other = e.hand === 'left' ? frame.hands.right : frame.hands.left;
        if (e.label === 'fist' && other?.label === 'fist' && !skip.has('fists')) {
          engine.stopAll();
          looper.stop();
          app.notify('■ Silence total');
          continue;
        }
        if (this.combo.push(comboLabel(e.label), e.t) && !skip.has('combo')) {
          const { root, scale } = app.settings;
          [0, 2, 4, 7].forEach((deg, i) => setTimeout(() => engine.playChord(triad(root, scale, deg), 0.35, 0.8), i * 180));
          app.notify('🎸 Combo : riff !');
        }
        if (skip.has(e.label)) continue;
        switch (e.label) {
          case 'like':
            app.notify(`🔊 Volume ${Math.round(engine.volumeStep(0.1) * 100)} %`);
            break;
          case 'dislike':
            app.notify(`🔉 Volume ${Math.round(engine.volumeStep(-0.1) * 100)} %`);
            break;
          case 'rock':
            app.notify(`🤘 Distorsion ${engine.setDistortion(!engine.distortionOn) ? 'activée' : 'coupée'}`);
            break;
          case 'call':
            app.notify(`🤙 Wah ${engine.setWah(!engine.wahOn) ? 'activé' : 'coupé'}`);
            break;
          case 'gun':
            looper.toggleRecord();
            app.notify(`🔁 Boucle : ${looper.status()}`);
            break;
          default:
            break;
        }
      } else if (e.type === 'pose_double' && e.label === 'gun' && !skip.has('gun')) {
        // Le deuxième pistolet a relancé un enregistrement : on l'annule puis on retire la dernière couche.
        looper.recording = null;
        looper.undo();
        app.notify(`↩ Couche annulée : ${looper.status()}`);
      } else if ((e.type === 'swipe_left' || e.type === 'swipe_right') && e.hand === 'left' && !skip.has('swipe')) {
        const name = engine.cycleInstrument(e.type === 'swipe_right' ? 1 : -1);
        app.notify(`🎹 Instrument : ${name}`);
        app.refreshControls();
      }
    }
    return true;
  }
}
