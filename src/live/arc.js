// Choisir un mode avec la main droite : poing tenu ~0,2 s -> le sélecteur apparaît ;
// lever 1 à 5 doigts (déjà compté et stabilisé par HandTracker) choisit directement le mode
// (1 = batterie, 2 = basse, 3 = mélodie, 4 = fx, 5 = sculpt), confirmé après une tenue brève.
// Avant : poing dos à la caméra, glisser, ouvrir la main pour valider — trop difficile à faire
// reconnaître de façon fiable (l'orientation dos/paume était ambiguë selon la prise de vue).

export const ARC_MODES = ['drums', 'bass', 'melody', 'fx', 'sculpt'];
export const ARC_NAMES = { drums: 'batterie', bass: 'basse', melody: 'mélodie', fx: 'fx / dj', sculpt: 'sculpt' };

export class ArcSelector {
  constructor({ summonFrames = 6, confirmFrames = 6, lostMs = 600 } = {}) {
    Object.assign(this, { summonFrames, confirmFrames, lostMs });
    this.reset();
  }

  reset() {
    this.open = false;
    this.anchor = null; // position du poing à l'ouverture (pour l'affichage)
    this.hover = null; // nombre de doigts actuellement levés (1..5), ou null
    this.holdFrames = 0;
    this.fistFrames = 0;
    this.lastSeen = 0;
    this.armed = true; // il faut quitter le poing avant de pouvoir rouvrir le sélecteur
  }

  /**
   * @param {object|null} hand main droite (label, count, palm, size)
   * @returns {{type:'opened'|'selected'|'cancelled'|null, mode?:string}}
   */
  update(hand, t) {
    if (!hand) {
      if (this.open && t - this.lastSeen > this.lostMs) {
        this.reset();
        return { type: 'cancelled' };
      }
      return { type: null };
    }
    this.lastSeen = t;
    const isFist = hand.label === 'fist';

    if (!this.open) {
      if (!isFist) this.armed = true;
      this.fistFrames = isFist && this.armed ? this.fistFrames + 1 : 0;
      if (this.fistFrames >= this.summonFrames) {
        this.open = true;
        this.armed = false;
        this.anchor = { x: hand.palm.x, y: hand.palm.y };
        this.hover = null;
        this.holdFrames = 0;
        return { type: 'opened' };
      }
      return { type: null };
    }

    // Sélecteur ouvert : le nombre de doigts choisit le mode, confirmé après une tenue brève.
    const count = hand.count;
    if (count !== null && count >= 1 && count <= ARC_MODES.length) {
      this.holdFrames = count === this.hover ? this.holdFrames + 1 : 1;
      this.hover = count;
      if (this.holdFrames >= this.confirmFrames) {
        const mode = ARC_MODES[count - 1];
        this.reset();
        this.armed = true;
        return { type: 'selected', mode };
      }
    } else {
      this.hover = null;
      this.holdFrames = 0;
    }
    return { type: null };
  }
}
