// Chargement des classifieurs entraînés en Python (training/) et convertis en TF.js.
// Les deux modèles sont optionnels : sans eux, l'application utilise les règles géométriques.

import * as tf from '@tensorflow/tfjs';
import { POSE_DIM, FRAME_DIM, resampleByTime, sequenceFeatures } from '../core/landmarks.js';

async function loadLabels(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

async function exists(url) {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    return res.ok && !(res.headers.get('content-type') ?? '').includes('text/html');
  } catch {
    return false;
  }
}

/** Classifieur de poses statiques (MLP, 63 entrées). */
export class PoseModel {
  static async load(base = 'models/pose/') {
    if (!(await exists(`${base}model.json`))) return null;
    const model = await tf.loadLayersModel(`${base}model.json`);
    const meta = await loadLabels(`${base}labels.json`);
    return new PoseModel(model, meta.labels ?? meta);
  }

  constructor(model, labels) {
    this.model = model;
    this.labels = labels;
  }

  predict(features) {
    if (features.length !== POSE_DIM) return null;
    const probs = tf.tidy(() => this.model.predict(tf.tensor2d([features])).dataSync());
    let best = 0;
    for (let i = 1; i < probs.length; i++) if (probs[i] > probs[best]) best = i;
    return { label: this.labels[best], confidence: probs[best] };
  }
}

/** Classifieur de gestes dynamiques (séquences de T images x 67 valeurs). */
export class DynamicModel {
  static async load(base = 'models/dynamic/') {
    if (!(await exists(`${base}model.json`))) return null;
    const model = await tf.loadLayersModel(`${base}model.json`);
    const meta = await loadLabels(`${base}labels.json`);
    const steps = model.inputs[0].shape[1] ?? meta.steps ?? 24;
    return new DynamicModel(model, meta.labels ?? meta, steps);
  }

  constructor(model, labels, steps) {
    this.model = model;
    this.labels = labels;
    this.steps = steps;
  }

  /** @param {{t:number, hand:object|null}[]} buffer fenêtre récente d'une main */
  predict(buffer) {
    if (buffer.filter((f) => f.hand).length < this.steps / 2) return null;
    const seq = sequenceFeatures(resampleByTime(buffer, this.steps));
    if (seq[0].length !== FRAME_DIM) return null;
    const probs = tf.tidy(() => this.model.predict(tf.tensor3d([seq])).dataSync());
    let best = 0;
    for (let i = 1; i < probs.length; i++) if (probs[i] > probs[best]) best = i;
    return { label: this.labels[best], confidence: probs[best] };
  }
}
