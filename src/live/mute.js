// Silence à deux poings, en version stricte : les deux mains doivent être vraiment fermées
// (pas une main à moitié fermée) pendant plusieurs images avant de couper le son.

/** Poing franc : pose « fist », aucun doigt levé et doigts bien serrés contre la paume. */
export function isTightFist(hand, maxOpenness = 0.85) {
  if (!hand) return false;
  if (hand.rawLabel !== 'fist') return false;
  if (hand.fingers?.some(Boolean)) return false;
  return (hand.openness ?? Infinity) < maxOpenness;
}

/** Main clairement ouverte ou dépliée : de quoi lever le silence. */
function isReleased(hand, minOpenness) {
  return !hand || hand.rawLabel !== 'fist' || (hand.openness ?? 0) > minOpenness;
}

export class MuteDetector {
  constructor({ enterFrames = 8, exitFrames = 4, maxOpenness = 0.85, releaseOpenness = 1.0 } = {}) {
    Object.assign(this, { enterFrames, exitFrames, maxOpenness, releaseOpenness });
    this.reset();
  }

  reset() {
    this.muted = false;
    this.fistFrames = 0;
    this.openFrames = 0;
  }

  /**
   * @returns {{muted:boolean, changed:boolean}}
   */
  update(left, right) {
    const was = this.muted;
    if (!this.muted) {
      this.fistFrames = isTightFist(left, this.maxOpenness) && isTightFist(right, this.maxOpenness) ? this.fistFrames + 1 : 0;
      if (this.fistFrames >= this.enterFrames) {
        this.muted = true;
        this.openFrames = 0;
      }
    } else {
      const released = isReleased(left, this.releaseOpenness) || isReleased(right, this.releaseOpenness);
      this.openFrames = released ? this.openFrames + 1 : 0;
      if (this.openFrames >= this.exitFrames) {
        this.muted = false;
        this.fistFrames = 0;
      }
    }
    return { muted: this.muted, changed: this.muted !== was };
  }
}
