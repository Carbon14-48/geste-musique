// Classifieur de poses entraîné directement dans le navigateur avec TensorFlow.js,
// sur les mains du joueur. Entrées : les 63 valeurs de normalizePose ; sortie : la pose.
// Même interface que PoseModel (predict -> {label, confidence}) : handTracker l'utilise tel quel.

import * as tf from '@tensorflow/tfjs';
import { POSE_DIM } from '../core/landmarks.js';
import { LABELS_KEY } from './poses.js';

export { TRAINABLE_POSES } from './poses.js';

/**
 * Le réseau est minuscule : le processeur le fait tourner plus vite que WebGL,
 * et la carte graphique reste libre pour MediaPipe.
 */
export async function useCpu() {
  if (tf.getBackend() !== 'cpu') await tf.setBackend('cpu');
}

export const SAVE_URL = 'indexeddb://geste-live-pose';

export function buildModel(classes) {
  const model = tf.sequential();
  model.add(tf.layers.dense({ inputShape: [POSE_DIM], units: 64, activation: 'relu' }));
  model.add(tf.layers.dropout({ rate: 0.2 }));
  model.add(tf.layers.dense({ units: 32, activation: 'relu' }));
  model.add(tf.layers.dense({ units: classes, activation: 'softmax' }));
  model.compile({ optimizer: tf.train.adam(0.005), loss: 'categoricalCrossentropy', metrics: ['accuracy'] });
  return model;
}

export class BrowserPoseModel {
  constructor(model, labels) {
    this.model = model;
    this.labels = labels;
  }

  /**
   * @param {{label:string, x:number[]}[]} samples
   * @param {{epochs?:number, onProgress?:(epoch:number, epochs:number, acc:number)=>void}} options
   */
  static async train(samples, { epochs = 40, onProgress } = {}) {
    await useCpu();
    const labels = [...new Set(samples.map((s) => s.label))];
    if (labels.length < 2) throw new Error('il faut au moins deux poses enregistrées');
    const model = buildModel(labels.length);
    const xs = tf.tensor2d(samples.map((s) => s.x));
    const labelIdx = tf.tensor1d(samples.map((s) => labels.indexOf(s.label)), 'int32');
    const ys = tf.oneHot(labelIdx, labels.length);
    labelIdx.dispose();
    let accuracy = 0;
    try {
      await model.fit(xs, ys, {
        epochs,
        batchSize: 32,
        shuffle: true,
        callbacks: {
          onEpochEnd: (epoch, logs) => {
            accuracy = logs.acc ?? logs.accuracy ?? 0;
            onProgress?.(epoch + 1, epochs, accuracy);
          },
        },
      });
    } finally {
      xs.dispose();
      ys.dispose();
    }
    const out = new BrowserPoseModel(model, labels);
    out.accuracy = accuracy;
    return out;
  }

  static async load() {
    try {
      const labels = JSON.parse(localStorage.getItem(LABELS_KEY) ?? 'null');
      if (!labels) return null;
      await useCpu();
      const model = await tf.loadLayersModel(SAVE_URL);
      return new BrowserPoseModel(model, labels);
    } catch {
      return null;
    }
  }

  static async remove() {
    try {
      localStorage.removeItem(LABELS_KEY);
      await tf.io.removeModel(SAVE_URL);
    } catch {
      // rien à effacer
    }
  }

  async save() {
    await this.model.save(SAVE_URL);
    localStorage.setItem(LABELS_KEY, JSON.stringify(this.labels));
  }

  predict(features) {
    if (features.length !== POSE_DIM) return null;
    const probs = tf.tidy(() => this.model.predict(tf.tensor2d([features])).dataSync());
    let best = 0;
    for (let i = 1; i < probs.length; i++) if (probs[i] > probs[best]) best = i;
    return { label: this.labels[best], confidence: probs[best] };
  }

  /** Libère les poids et l'état de l'optimiseur (GPU/CPU) : à appeler avant de remplacer ce modèle par un autre. */
  dispose() {
    this.model.optimizer?.dispose?.();
    this.model.dispose();
  }
}
