// Filtre One Euro (Casiez et al., 2012) : lisse fortement quand la main est immobile,
// et presque pas quand elle bouge vite, ce qui garde une latence faible.

function alpha(cutoff, dt) {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

export class OneEuroFilter {
  constructor({ minCutoff = 1.0, beta = 0.02, dCutoff = 1.0 } = {}) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.reset();
  }

  reset() {
    this.x = null;
    this.dx = 0;
    this.t = null;
  }

  /** @param {number} value @param {number} t temps en secondes */
  filter(value, t) {
    if (this.x === null || this.t === null || t <= this.t) {
      this.x = value;
      this.t = t;
      return value;
    }
    const dt = t - this.t;
    this.t = t;
    const rawDx = (value - this.x) / dt;
    this.dx += alpha(this.dCutoff, dt) * (rawDx - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += alpha(cutoff, dt) * (value - this.x);
    return this.x;
  }
}

/** Filtre les 21 points (x, y, z) d'une main. */
export class LandmarkSmoother {
  constructor(options) {
    this.options = options;
    this.filters = null;
  }

  reset() {
    this.filters = null;
  }

  smooth(points, t) {
    if (!this.filters || this.filters.length !== points.length) {
      this.filters = points.map(() => [0, 1, 2].map(() => new OneEuroFilter(this.options)));
    }
    return points.map((p, i) => {
      const f = this.filters[i];
      return {
        x: f[0].filter(p.x, t),
        y: f[1].filter(p.y, t),
        z: f[2].filter(p.z ?? 0, t),
      };
    });
  }
}
