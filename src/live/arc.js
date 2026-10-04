// L'arc des modes de la main droite :
// poing (dos de la main vers la caméra) -> l'arc apparaît ; déplacer la main -> la case la plus proche s'allume ;
// ouvrir la main paume vers la caméra -> le mode est choisi ; l'ouvrir dos vers la caméra -> annuler.

export const ARC_MODES = ['drums', 'bass', 'melody', 'fx', 'sculpt'];
export const ARC_NAMES = { drums: 'batterie', bass: 'basse', melody: 'mélodie', fx: 'fx / dj', sculpt: 'sculpt' };

export class ArcSelector {
  constructor({ summonFrames = 6, cellWidth = 1.1, lostMs = 600, requireBack = true } = {}) {
    Object.assign(this, { summonFrames, cellWidth, lostMs, requireBack });
    this.reset();
  }

  reset() {
    this.open = false;
    this.anchor = null; // position du poing à l'ouverture
    this.hover = 2;
    this.fistFrames = 0;
    this.lastSeen = 0;
    this.armed = true; // il faut quitter le poing avant de pouvoir rouvrir l'arc
  }

  /**
   * @param {object|null} hand main droite (label, palmFacing, palm, size)
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
    const isOpen = hand.label === 'open' || hand.label === 'palm';

    if (!this.open) {
      if (!isFist) this.armed = true;
      if (isFist && this.armed && (!this.requireBack || !hand.palmFacing)) this.fistFrames++;
      else this.fistFrames = 0;
      if (this.fistFrames >= this.summonFrames) {
        this.open = true;
        this.armed = false;
        this.anchor = { x: hand.palm.x, y: hand.palm.y };
        this.hover = 2;
        return { type: 'opened' };
      }
      return { type: null };
    }

    // Arc ouvert : la case dépend du déplacement horizontal depuis l'ouverture (en tailles de main).
    const dx = (hand.palm.x - this.anchor.x) / Math.max(hand.size, 0.02);
    this.hover = Math.max(0, Math.min(ARC_MODES.length - 1, 2 + Math.round(dx / this.cellWidth)));
    if (isOpen) {
      const mode = ARC_MODES[this.hover];
      const confirmed = hand.palmFacing || !this.requireBack;
      this.reset();
      this.armed = true;
      return confirmed ? { type: 'selected', mode } : { type: 'cancelled' };
    }
    return { type: null };
  }
}
