// La roue d'instruments de la main gauche :
// poing gauche tenu -> la roue apparaît ; tourner le poignet -> l'instrument survolé change ;
// ouvrir la main -> l'instrument est choisi ; main perdue -> annuler.
// Les crans sont comptés depuis l'angle du poignet à l'ouverture : la roue part de l'instrument courant.

export class InstrumentWheel {
  constructor({ count, summonFrames = 15, stepDeg = 11, lostMs = 600 } = {}) {
    Object.assign(this, { count, summonFrames, stepDeg, lostMs });
    this.reset();
  }

  reset() {
    this.open = false;
    this.start = 0; // instrument courant à l'ouverture
    this.hover = 0;
    this.offset = 0; // crans depuis l'ouverture
    this.tilt0 = 0;
    this.anchor = null;
    this.fistFrames = 0;
    this.lastSeen = 0;
    this.armed = true; // il faut quitter le poing avant de pouvoir rouvrir la roue
  }

  wrap(i) {
    return ((i % this.count) + this.count) % this.count;
  }

  /**
   * @param {object|null} hand main gauche (label, tilt, palm)
   * @param {number} current index de l'instrument courant
   * @param {boolean} blocked vrai si l'autre main est aussi un poing (le silence est prioritaire)
   * @returns {{type:'opened'|'selected'|'cancelled'|null, index?:number}}
   */
  update(hand, current, t, blocked = false) {
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
      this.fistFrames = isFist && this.armed && !blocked ? this.fistFrames + 1 : 0;
      if (this.fistFrames >= this.summonFrames) {
        this.open = true;
        this.armed = false;
        this.start = this.wrap(current);
        this.hover = this.start;
        this.offset = 0;
        this.tilt0 = hand.tilt;
        this.anchor = { x: hand.palm.x, y: hand.palm.y };
        return { type: 'opened' };
      }
      return { type: null };
    }
    if (blocked) {
      this.reset();
      this.armed = false;
      return { type: 'cancelled' };
    }

    // Hystérésis : on ne change de cran qu'après avoir dépassé le milieu de 0,6 cran.
    const rel = (hand.tilt - this.tilt0) / this.stepDeg;
    if (Math.abs(rel - this.offset) > 0.6) this.offset = Math.round(rel);
    this.hover = this.wrap(this.start + this.offset);
    if (isOpen) {
      const index = this.hover;
      this.reset();
      return { type: 'selected', index };
    }
    return { type: null };
  }
}
