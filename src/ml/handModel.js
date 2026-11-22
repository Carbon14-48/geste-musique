// « HandNet » : un seul réseau TensorFlow.js qui reconnaît toute la forme de la main.
// Entrée : les 42 valeurs de handFeatures2d (21 points image x, y). Quatre sorties :
//   pose    (softmax)  : quelle pose (poing, 1 doigt, cornes…)
//   fingers (sigmoïde) : chaque doigt levé ou non (donne aussi le comptage)
//   palm    (sigmoïde) : paume tournée vers la caméra (sinon dos de la main)
//   down    (sigmoïde) : doigts vers le bas
// Il est pré-entraîné en Python sur HaGRID (training/train_hand.py, public/models/hand/)
// puis affiné dans la page sur les mains du joueur (fineTune).

import * as tf from '@tensorflow/tfjs';
import { HAND2D_DIM } from '../core/landmarks.js';
import { HAND_MODEL_DIR, HEADS, LABELS_KEY, decodeHand, poseFingers } from './poses.js';

export const SAVE_URL = 'indexeddb://geste-live-hand';
const BASE = import.meta.env?.BASE_URL ?? '/';

/**
 * Le réseau est minuscule : le processeur le fait tourner plus vite que WebGL,
 * et la carte graphique reste libre pour MediaPipe.
 */
export async function useCpu() {
  if (tf.getBackend() !== 'cpu') await tf.setBackend('cpu');
}

/** Même architecture que training/train_hand.py (utilisée seulement sans modèle de base). */
export function buildHandNet(nLabels) {
  const input = tf.input({ shape: [HAND2D_DIM], name: 'hand_input' });
  let x = tf.layers.dense({ units: 128, activation: 'relu', name: 'dense_a' }).apply(input);
  x = tf.layers.dropout({ rate: 0.3 }).apply(x);
  x = tf.layers.dense({ units: 64, activation: 'relu', name: 'trunk' }).apply(x);
  x = tf.layers.dropout({ rate: 0.2 }).apply(x);
  return tf.model({
    inputs: input,
    outputs: [
      tf.layers.dense({ units: nLabels, activation: 'softmax', name: 'pose' }).apply(x),
      tf.layers.dense({ units: 5, activation: 'sigmoid', name: 'fingers' }).apply(x),
      tf.layers.dense({ units: 1, activation: 'sigmoid', name: 'palm' }).apply(x),
      tf.layers.dense({ units: 1, activation: 'sigmoid', name: 'down' }).apply(x),
    ],
  });
}

/**
 * Entropie croisée binaire qui ignore les cibles à -1 (étiquette inconnue :
 * par exemple les doigts d'une pose « autre »).
 */
export function maskedBce(yTrue, yPred) {
  return tf.tidy(() => {
    const mask = tf.cast(tf.greaterEqual(yTrue, 0), 'float32');
    const p = tf.clipByValue(yPred, 1e-6, 1 - 1e-6);
    const t = tf.mul(yTrue, mask);
    const bce = tf.neg(tf.add(tf.mul(t, tf.log(p)), tf.mul(tf.sub(1, t), tf.log(tf.sub(1, p)))));
    return tf.div(tf.sum(tf.mul(bce, mask)), tf.maximum(tf.sum(mask), 1));
  });
}

/**
 * Remplace la sortie « pose » par une sortie plus large quand le joueur ajoute des poses
 * inconnues du modèle de base (ex. cornes + pouce, absent de HaGRID). Les poids des
 * poses déjà connues sont recopiés : le modèle n'oublie pas ce qu'il savait.
 */
function widenPoseHead(base, oldLabels, labels) {
  const oldHead = base.getLayer('pose');
  const trunkOut = oldHead.input; // sortie du tronc (après dropout)
  const [kernel, bias] = oldHead.getWeights();
  const head = tf.layers.dense({ units: labels.length, activation: 'softmax', name: 'pose' });
  const out = head.apply(trunkOut);
  const k = tf.tidy(() => {
    const cols = labels.map((l) => {
      const i = oldLabels.indexOf(l);
      return i >= 0 ? kernel.slice([0, i], [-1, 1]) : tf.randomNormal([kernel.shape[0], 1], 0, 0.05);
    });
    return tf.concat(cols, 1);
  });
  const b = tf.tidy(() => {
    const vals = bias.dataSync();
    return tf.tensor1d(labels.map((l) => (oldLabels.includes(l) ? vals[oldLabels.indexOf(l)] : 0)));
  });
  head.setWeights([k, b]);
  k.dispose();
  b.dispose();
  return tf.model({
    inputs: base.inputs,
    outputs: [out, base.getLayer('fingers').output, base.getLayer('palm').output, base.getLayer('down').output],
  });
}

export class HandModel {
  /**
   * @param {tf.LayersModel} model réseau à 4 sorties
   * @param {string[]} labels étiquettes de la sortie « pose »
   * @param {object} meta informations (source, précision…)
   */
  constructor(model, labels, meta = {}) {
    this.model = model;
    this.labels = labels;
    this.meta = meta;
  }

  /** Modèle Python (public/models/hand/), ou null s'il n'existe pas. */
  static async loadBase(dir = `${BASE}${HAND_MODEL_DIR}`) {
    try {
      const res = await fetch(`${dir}labels.json`);
      if (!res.ok || (res.headers.get('content-type') ?? '').includes('text/html')) return null;
      const meta = await res.json();
      await useCpu();
      const model = await tf.loadLayersModel(`${dir}model.json`);
      return new HandModel(model, meta.labels, { ...meta, source: 'hagrid' });
    } catch {
      return null;
    }
  }

  /** Modèle affiné sur les mains du joueur (IndexedDB), ou null. */
  static async loadSaved() {
    try {
      const meta = JSON.parse(localStorage.getItem(LABELS_KEY) ?? 'null');
      if (!meta?.labels) return null;
      await useCpu();
      const model = await tf.loadLayersModel(SAVE_URL);
      return new HandModel(model, meta.labels, { ...meta, source: 'perso' });
    } catch {
      return null;
    }
  }

  static async removeSaved() {
    try {
      localStorage.removeItem(LABELS_KEY);
      await tf.io.removeModel(SAVE_URL);
    } catch {
      // rien à effacer
    }
  }

  /**
   * Affine un modèle sur les exemples du joueur.
   * 1) le tronc (ce qui a été appris sur HaGRID) est gelé et seules les 4 sorties s'adaptent ;
   * 2) puis tout le réseau s'ajuste doucement (petit pas d'apprentissage).
   * @param {{label:string, x:number[], palm:boolean, down:boolean}[]} samples
   * @param {HandModel|null} base modèle de départ (consommé : ses poids sont réutilisés) ;
   *   null = entraînement à partir de zéro
   * @param {{epochs?:number, onProgress?:(epoch:number, epochs:number, acc:number)=>void}} options
   */
  static async fineTune(samples, base, { epochs = 30, onProgress } = {}) {
    await useCpu();
    const own = [...new Set(samples.map((s) => s.label))];
    if (own.length < 2 && !base) throw new Error('il faut au moins deux poses enregistrées');
    const baseLabels = base?.labels ?? [];
    const labels = [...baseLabels, ...own.filter((l) => !baseLabels.includes(l))];

    let model;
    if (!base) model = buildHandNet(labels.length);
    else if (labels.length !== baseLabels.length) model = widenPoseHead(base.model, baseLabels, labels);
    else model = base.model;

    const xs = tf.tensor2d(samples.map((s) => s.x));
    const ys = tf.tidy(() => [
      tf.oneHot(tf.tensor1d(samples.map((s) => labels.indexOf(s.label)), 'int32'), labels.length),
      tf.tensor2d(samples.map((s) => (poseFingers(s.label) ?? [-1, -1, -1, -1, -1]).map((f) => (f === -1 ? -1 : +f)))),
      tf.tensor2d(samples.map((s) => [s.palm === undefined ? -1 : +s.palm])),
      tf.tensor2d(samples.map((s) => [s.down === undefined ? -1 : +s.down])),
    ]);

    const trunkLayers = model.layers.filter((l) => ['dense_a', 'trunk'].includes(l.name));
    const phases = base
      ? [{ frozen: true, lr: 0.005, epochs: Math.ceil(epochs * 0.6) }, { frozen: false, lr: 0.0005, epochs: Math.floor(epochs * 0.4) }]
      : [{ frozen: false, lr: 0.005, epochs }];
    let done = 0;
    let accuracy = 0;
    try {
      for (const phase of phases) {
        for (const l of trunkLayers) l.trainable = !phase.frozen;
        model.compile({
          optimizer: tf.train.adam(phase.lr),
          loss: ['categoricalCrossentropy', maskedBce, maskedBce, maskedBce],
          lossWeights: [1, 0.5, 0.5, 0.5],
          metrics: { pose: 'accuracy' },
        });
        await model.fit(xs, ys, {
          epochs: phase.epochs,
          batchSize: 32,
          shuffle: true,
          callbacks: {
            onEpochEnd: (_, logs) => {
              done++;
              accuracy = logs.pose_acc ?? logs.pose_accuracy ?? logs.acc ?? 0;
              onProgress?.(done, epochs, accuracy);
            },
          },
        });
      }
    } finally {
      for (const l of trunkLayers) l.trainable = true;
      xs.dispose();
      ys.forEach((t) => t.dispose());
    }
    const trained = [...new Set([...(base?.meta.trained_heads ?? ['pose', 'fingers']), 'palm', 'down'])];
    return new HandModel(model, labels, { source: 'perso', accuracy, samples: samples.length, trained_heads: trained });
  }

  async save() {
    await this.model.save(SAVE_URL);
    localStorage.setItem(
      LABELS_KEY,
      JSON.stringify({ labels: this.labels, accuracy: this.meta.accuracy, trained_heads: this.meta.trained_heads }),
    );
  }

  /** Le tracker doit lui donner handFeatures2d (et non normalizePose). */
  get input2d() {
    return true;
  }

  /** @param {number[]} features handFeatures2d (42 valeurs) */
  predict(features) {
    if (features.length !== HAND2D_DIM) return null;
    const [pose, fingers, palm, down] = tf.tidy(() => this.model.predict(tf.tensor2d([features])).map((t) => t.dataSync()));
    return decodeHand(this.labels, pose, fingers, palm[0], down[0], this.meta.trained_heads ?? HEADS);
  }

  /** Libère les poids et l'état de l'optimiseur : à appeler avant de remplacer ce modèle. */
  dispose() {
    this.model.optimizer?.dispose?.();
    this.model.dispose();
  }
}
