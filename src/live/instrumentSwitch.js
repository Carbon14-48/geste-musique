// Changer d'instrument : un geste court à la main gauche, libre (pas utilisé par les accords) et
// fiable (testé avec des mains synthétiques : "pouce levé/baissé" était trop ambigu selon la
// rotation du poignet, "pouce + index" et "pouce + auriculaire" sont reconnus à 100 % dans les mêmes
// conditions). Tenir la pose ~0,5 s (stabilisation déjà faite par HandTracker, événement
// "pose_hold") déclenche le changement ; un temps de pause évite de défiler plusieurs instruments
// d'un coup.

import { Cooldown } from '../core/trigger.js';

export class InstrumentSwitch {
  constructor({ cooldownMs = 800 } = {}) {
    this.cooldown = new Cooldown(cooldownMs);
  }

  /**
   * @param {{type:string, label:string, hand:string}[]} events frame.events (HandTracker.update)
   * @param {number} t
   * @returns {1|-1|0} +1 = instrument suivant (pouce + index), -1 = précédent (pouce + auriculaire), 0 = rien
   */
  update(events, t) {
    for (const e of events) {
      if (e.type !== 'pose_hold' || e.hand !== 'left') continue;
      if (e.label !== 'gun' && e.label !== 'call') continue;
      if (!this.cooldown.ready(t)) return 0;
      return e.label === 'gun' ? 1 : -1;
    }
    return 0;
  }
}
