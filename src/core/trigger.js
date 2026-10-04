// Déclencheurs (section 6 du catalogue) : stabilisation sur plusieurs images,
// hystérésis, maintien, double geste et séquences (combos).

/**
 * Transforme une étiquette brute (bruitée image par image) en événements stables :
 * enter / exit / hold / double.
 */
export class GestureStabilizer {
  constructor({ enterFrames = 4, exitFrames = 3, holdMs = 500, doubleMs = 600, idle = 'none' } = {}) {
    Object.assign(this, { enterFrames, exitFrames, holdMs, doubleMs, idle });
    this.reset();
  }

  reset() {
    this.current = this.idle;
    this.since = 0;
    this.candidate = null;
    this.candidateCount = 0;
    this.holdFired = false;
    this.lastEnter = {}; // label -> t de la dernière entrée
  }

  /** @returns {{type:string,label:string,t:number}[]} */
  update(label, t) {
    const events = [];
    if (label === this.current) {
      this.candidate = null;
      this.candidateCount = 0;
    } else {
      if (label === this.candidate) this.candidateCount++;
      else {
        this.candidate = label;
        this.candidateCount = 1;
      }
      const needed = label === this.idle ? this.exitFrames : this.enterFrames;
      if (this.candidateCount >= needed) {
        if (this.current !== this.idle) events.push({ type: 'exit', label: this.current, t });
        this.current = label;
        this.since = t;
        this.holdFired = false;
        this.candidate = null;
        this.candidateCount = 0;
        if (label !== this.idle) {
          const prev = this.lastEnter[label];
          events.push({ type: 'enter', label, t });
          if (prev !== undefined && t - prev <= this.doubleMs) {
            events.push({ type: 'double', label, t });
            delete this.lastEnter[label];
          } else {
            this.lastEnter[label] = t;
          }
        }
      }
    }
    if (this.current !== this.idle && !this.holdFired && t - this.since >= this.holdMs) {
      this.holdFired = true;
      events.push({ type: 'hold', label: this.current, t });
    }
    return events;
  }
}

/** Seuil avec hystérésis : passe à vrai au-dessus de `on`, revient à faux sous `off`. */
export class Hysteresis {
  constructor(on, off) {
    this.on = on;
    this.off = off;
    this.state = false;
  }

  update(value) {
    if (!this.state && value >= this.on) this.state = true;
    else if (this.state && value <= this.off) this.state = false;
    return this.state;
  }
}

/** Détecte une suite de gestes dans l'ordre, chaque étape en moins de `stepMs`. */
export class ComboDetector {
  constructor(sequence, { stepMs = 1200 } = {}) {
    this.sequence = sequence;
    this.stepMs = stepMs;
    this.index = 0;
    this.last = 0;
  }

  /** @returns {boolean} vrai quand la séquence complète vient d'être faite */
  push(label, t) {
    if (this.index > 0 && t - this.last > this.stepMs) this.index = 0;
    if (label === this.sequence[this.index]) {
      this.index++;
      this.last = t;
      if (this.index === this.sequence.length) {
        this.index = 0;
        return true;
      }
    } else if (label === this.sequence[0]) {
      this.index = 1;
      this.last = t;
    } else {
      this.index = 0;
    }
    return false;
  }
}

/** Limite la fréquence d'un événement. */
export class Cooldown {
  constructor(ms) {
    this.ms = ms;
    this.last = -Infinity;
  }

  ready(t) {
    if (t - this.last < this.ms) return false;
    this.last = t;
    return true;
  }
}
