// Gestes personnalisés appris directement dans le navigateur (k plus proches voisins
// sur les 63 valeurs normalisées). Quelques dizaines d'exemples suffisent, sans serveur.

const STORAGE_KEY = 'geste-musique.knn.v1';

export class KnnClassifier {
  constructor(k = 5) {
    this.k = k;
    this.samples = []; // {label, x: number[]}
  }

  get labels() {
    return [...new Set(this.samples.map((s) => s.label))];
  }

  countByLabel() {
    const out = {};
    for (const s of this.samples) out[s.label] = (out[s.label] ?? 0) + 1;
    return out;
  }

  add(label, features) {
    this.samples.push({ label, x: Array.from(features) });
  }

  removeLabel(label) {
    this.samples = this.samples.filter((s) => s.label !== label);
  }

  clear() {
    this.samples = [];
  }

  /** @returns {{label:string, confidence:number}|null} */
  predict(features) {
    if (this.samples.length === 0) return null;
    const scored = this.samples.map((s) => {
      let d = 0;
      for (let i = 0; i < s.x.length; i++) {
        const v = s.x[i] - features[i];
        d += v * v;
      }
      return { label: s.label, d };
    });
    scored.sort((a, b) => a.d - b.d);
    const k = Math.min(this.k, scored.length);
    const votes = {};
    for (let i = 0; i < k; i++) {
      const w = 1 / (Math.sqrt(scored[i].d) + 1e-3);
      votes[scored[i].label] = (votes[scored[i].label] ?? 0) + w;
    }
    const total = Object.values(votes).reduce((a, b) => a + b, 0);
    let best = null;
    for (const [label, v] of Object.entries(votes)) {
      if (!best || v > best.v) best = { label, v };
    }
    return { label: best.label, confidence: best.v / total, distance: Math.sqrt(scored[0].d) };
  }

  toJSON() {
    return { k: this.k, samples: this.samples };
  }

  load(data) {
    this.k = data?.k ?? this.k;
    this.samples = Array.isArray(data?.samples) ? data.samples : [];
  }

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.toJSON()));
    } catch {
      // stockage indisponible (navigation privée) : les gestes restent en mémoire
    }
  }

  restore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) this.load(JSON.parse(raw));
    } catch {
      this.samples = [];
    }
  }
}
