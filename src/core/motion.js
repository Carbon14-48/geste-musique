// Détection des mouvements (section 3 du catalogue).
// Toutes les vitesses sont exprimées en « tailles de main par seconde » pour que
// le jeu se comporte pareil à 40 cm et à 80 cm de la caméra.

import { Cooldown } from './trigger.js';

export const MOTION_DEFAULTS = {
  swipeDistance: 2.2, // déplacement minimal (tailles de main) dans la fenêtre
  swipeWindowMs: 280,
  swipeCooldownMs: 700,
  strumSpeed: 5, // vitesse verticale pour gratter
  strumRearm: 1.5,
  strikeSpeed: 6, // vitesse de descente pour une frappe
  strikeRelease: 0.5, // fraction du pic sous laquelle la frappe est validée
  tapSpeed: 4,
  shakeSpeed: 3,
  shakeWindowMs: 600,
  circleSpeed: 2,
};

/** Détecteur de frappe : pic de vitesse vers le bas suivi d'un freinage brusque. */
export class StrikeDetector {
  constructor(speed, release = 0.5) {
    this.speed = speed;
    this.release = release;
    this.peak = 0;
    this.armed = true;
  }

  /** @param {number} vy vitesse verticale (positive = vers le bas) @returns {number|null} vitesse du pic */
  update(vy) {
    if (!this.armed) {
      if (vy < 1) this.armed = true;
      return null;
    }
    if (vy > this.speed) {
      this.peak = Math.max(this.peak, vy);
      return null;
    }
    if (this.peak > 0 && vy < this.peak * this.release) {
      const peak = this.peak;
      this.peak = 0;
      this.armed = false;
      return peak;
    }
    if (vy <= 0) this.peak = 0;
    return null;
  }
}

/** Calcule le tempo (BPM) à partir des instants des frappes successives. */
export class TempoTracker {
  constructor(maxTaps = 6) {
    this.maxTaps = maxTaps;
    this.taps = [];
  }

  tap(t) {
    if (this.taps.length && t - this.taps[this.taps.length - 1] > 2000) this.taps = [];
    this.taps.push(t);
    if (this.taps.length > this.maxTaps) this.taps.shift();
    return this.bpm();
  }

  bpm() {
    if (this.taps.length < 3) return null;
    const intervals = [];
    for (let i = 1; i < this.taps.length; i++) intervals.push(this.taps[i] - this.taps[i - 1]);
    intervals.sort((a, b) => a - b);
    const median = intervals[Math.floor(intervals.length / 2)];
    return Math.round(60000 / median);
  }
}

/** Suit le mouvement d'une main et émet des événements de mouvement. */
export class MotionTracker {
  constructor(options = {}) {
    this.o = { ...MOTION_DEFAULTS, ...options };
    this.history = []; // {t, x, y, tipY, size}
    this.swipeCd = new Cooldown(this.o.swipeCooldownMs);
    this.shakeCd = new Cooldown(120);
    this.strike = new StrikeDetector(this.o.strikeSpeed, this.o.strikeRelease);
    this.tap = new StrikeDetector(this.o.tapSpeed, this.o.strikeRelease);
    this.strumArmed = true;
    this.reversals = [];
    this.lastSignX = 0;
    this.circleAcc = 0;
    this.lastAngle = null;
    this.velocity = { x: 0, y: 0, speed: 0 };
  }

  reset() {
    this.history = [];
    this.reversals = [];
    this.circleAcc = 0;
    this.lastAngle = null;
    this.strumArmed = true;
    this.velocity = { x: 0, y: 0, speed: 0 };
  }

  /**
   * @param {number} t ms
   * @param {{x:number,y:number}} palm centre de la paume, coordonnées écran 0..1
   * @param {number} tipY ordonnée écran du bout de l'index
   * @param {number} size taille de la main à l'écran
   * @returns {{type:string,[k:string]:any}[]}
   */
  update(t, palm, tipY, size) {
    const events = [];
    const h = this.history;
    h.push({ t, x: palm.x, y: palm.y, tipY, size: Math.max(size, 1e-3) });
    while (h.length > 2 && t - h[0].t > 1000) h.shift();
    if (h.length < 2) return events;

    const a = h[h.length - 2];
    const b = h[h.length - 1];
    const dt = Math.max((b.t - a.t) / 1000, 1e-3);
    const s = b.size;
    const vx = (b.x - a.x) / dt / s;
    const vy = (b.y - a.y) / dt / s;
    const vTip = (b.tipY - a.tipY) / dt / s;
    // Lissage léger de la vitesse.
    this.velocity.x = 0.5 * this.velocity.x + 0.5 * vx;
    this.velocity.y = 0.5 * this.velocity.y + 0.5 * vy;
    this.velocity.speed = Math.hypot(this.velocity.x, this.velocity.y);
    const V = this.velocity;

    // Balayages : grand déplacement dans une courte fenêtre.
    const start = h.find((p) => t - p.t <= this.o.swipeWindowMs) ?? h[0];
    const dx = (b.x - start.x) / s;
    const dy = (b.y - start.y) / s;
    if (Math.abs(dx) > this.o.swipeDistance && Math.abs(dx) > 2 * Math.abs(dy) && this.swipeCd.ready(t)) {
      events.push({ type: dx > 0 ? 'swipe_right' : 'swipe_left', speed: Math.abs(dx) });
    } else if (Math.abs(dy) > this.o.swipeDistance && Math.abs(dy) > 2 * Math.abs(dx) && this.swipeCd.ready(t)) {
      events.push({ type: dy > 0 ? 'swipe_down' : 'swipe_up', speed: Math.abs(dy) });
    }

    // Grattage : franchissement d'un seuil de vitesse verticale.
    if (this.strumArmed && Math.abs(V.y) > this.o.strumSpeed) {
      events.push({ type: 'strum', dir: V.y > 0 ? 'down' : 'up', speed: Math.abs(V.y) });
      this.strumArmed = false;
    } else if (!this.strumArmed && Math.abs(V.y) < this.o.strumRearm) {
      this.strumArmed = true;
    }

    // Frappe (paume) et tape (bout de l'index).
    const strike = this.strike.update(V.y);
    if (strike !== null) events.push({ type: 'strike', speed: strike });
    const tap = this.tap.update(vTip);
    if (tap !== null) events.push({ type: 'tap', speed: tap });

    // Secouer : inversions rapides de la vitesse horizontale.
    if (Math.abs(V.x) > this.o.shakeSpeed) {
      const sign = Math.sign(V.x);
      if (this.lastSignX !== 0 && sign !== this.lastSignX) {
        this.reversals.push(t);
        this.reversals = this.reversals.filter((r) => t - r <= this.o.shakeWindowMs);
        if (this.reversals.length >= 2 && this.shakeCd.ready(t)) events.push({ type: 'shake', speed: Math.abs(V.x) });
      }
      this.lastSignX = sign;
    }

    // Cercle : accumulation de l'angle de la direction du mouvement.
    if (V.speed > this.o.circleSpeed) {
      const ang = Math.atan2(V.y, V.x);
      if (this.lastAngle !== null) {
        let d = ang - this.lastAngle;
        if (d > Math.PI) d -= 2 * Math.PI;
        if (d < -Math.PI) d += 2 * Math.PI;
        this.circleAcc += d;
        if (Math.abs(this.circleAcc) > 2 * Math.PI) {
          events.push({ type: this.circleAcc > 0 ? 'circle_cw' : 'circle_ccw' });
          this.circleAcc = 0;
        }
      }
      this.lastAngle = ang;
    } else {
      this.circleAcc *= 0.9;
      this.lastAngle = null;
    }
    return events;
  }
}
