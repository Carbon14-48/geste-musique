// Pincement pouce + doigt (index, majeur, annulaire, auriculaire).
// Un pincement ne commence que si la main est immobile et qu'un autre doigt est levé,
// pour qu'une main qui se referme ne soit pas prise pour un pincement.

export const PINCH_FINGERS = ['index', 'majeur', 'annulaire', 'auriculaire'];

export class PinchTracker {
  constructor({ on = 0.3, off = 0.45, maxSpeed = 2.5 } = {}) {
    Object.assign(this, { on, off, maxSpeed });
    this.finger = null;
  }

  reset() {
    this.finger = null;
  }

  /**
   * @param {object|null} hand état de main (HandTracker) : pinches[4], fingers[5], velocity
   * @returns {{finger:number|null, started:number|null, ended:number|null}}
   */
  update(hand) {
    const out = { finger: this.finger, started: null, ended: null };
    if (!hand) {
      if (this.finger !== null) out.ended = this.finger;
      this.finger = null;
      out.finger = null;
      return out;
    }
    const d = hand.pinches;
    if (this.finger !== null) {
      if (d[this.finger] > this.off) {
        out.ended = this.finger;
        this.finger = null;
      }
    }
    if (this.finger === null) {
      let best = -1;
      for (let i = 0; i < 4; i++) if (d[i] < this.on && (best < 0 || d[i] < d[best])) best = i;
      if (best >= 0) {
        // Un autre doigt long (hors pouce et hors doigt pincé) doit être levé.
        const otherUp = hand.fingers.some((up, k) => k >= 1 && k - 1 !== best && up);
        const still = (hand.velocity?.speed ?? 0) < this.maxSpeed;
        if (otherUp && still) {
          this.finger = best;
          out.started = best;
        }
      }
    }
    out.finger = this.finger;
    return out;
  }
}
