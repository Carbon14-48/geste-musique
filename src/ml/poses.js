// Ce qu'il faut savoir sur les modèles de mains sans charger TensorFlow.js (1,3 Mo) :
// la liste des poses à apprendre, la table des doigts, le décodage des sorties du réseau
// et la présence d'un modèle à charger.

import FINGER_TABLE from '../../shared/pose_fingers.json';

export const LABELS_KEY = 'geste-live.hand-labels';
const BASE = import.meta.env?.BASE_URL ?? '/';

/** Dossier du modèle entraîné en Python (training/train_hand.py). */
export const HAND_MODEL_DIR = 'models/hand/';

/** Les 4 sorties du réseau, dans l'ordre. */
export const HEADS = ['pose', 'fingers', 'palm', 'down'];

/** Poses proposées dans le panneau « Apprendre mes gestes » (étiquettes = celles du modèle). */
export const TRAINABLE_POSES = [
  { label: 'fist', name: 'poing' },
  { label: 'one', name: '1 doigt' },
  { label: 'two', name: '2 doigts' },
  { label: 'three', name: '3 doigts' },
  { label: 'four', name: '4 doigts' },
  { label: 'palm', name: 'main ouverte' },
  { label: 'rock', name: 'cornes' },
  { label: 'hornsThumb', name: 'cornes + pouce' },
  { label: 'gun', name: 'pouce + index' },
  { label: 'call', name: 'pouce + auriculaire' },
  { label: 'other', name: 'autre / main relâchée' },
];

/**
 * Doigts levés d'une pose (pouce..auriculaire), lus dans shared/pose_fingers.json
 * (même fichier que training/common.py). null si la pose ne fixe pas les doigts.
 * @returns {boolean[]|null}
 */
export function poseFingers(label) {
  const bits = FINGER_TABLE.poses[label];
  return typeof bits === 'string' ? [...bits].map((b) => b === '1') : null;
}

/**
 * Transforme les 4 sorties brutes du réseau en état de main.
 * @param {string[]} labels étiquettes de la sortie « pose »
 * @param {ArrayLike<number>} poseProbs probabilités (softmax)
 * @param {ArrayLike<number>} fingerProbs 5 probabilités (sigmoïde) : chaque doigt levé ?
 * @param {number} palmProb probabilité « paume vers la caméra »
 * @param {number} downProb probabilité « doigts vers le bas »
 * @param {string[]} trained sorties réellement apprises (les autres sont renvoyées undefined)
 */
export function decodeHand(labels, poseProbs, fingerProbs, palmProb, downProb, trained = HEADS) {
  let best = 0;
  for (let i = 1; i < poseProbs.length; i++) if (poseProbs[i] > poseProbs[best]) best = i;
  const fingers = Array.from(fingerProbs, (p) => p >= 0.5);
  return {
    label: labels[best],
    confidence: poseProbs[best],
    probs: Object.fromEntries(labels.map((l, i) => [l, poseProbs[i]])),
    fingers: trained.includes('fingers') ? fingers : undefined,
    fingerProbs: Array.from(fingerProbs),
    count: trained.includes('fingers') ? fingers.filter(Boolean).length : undefined,
    palmFacing: trained.includes('palm') ? palmProb >= 0.5 : undefined,
    palmProb,
    pointsDown: trained.includes('down') ? downProb >= 0.5 : undefined,
    downProb,
  };
}

/** Un modèle personnel a-t-il été affiné dans ce navigateur ? */
export function hasSavedModel() {
  try {
    return localStorage.getItem(LABELS_KEY) !== null;
  } catch {
    return false;
  }
}

/** Le modèle entraîné en Python est-il publié dans public/models/hand/ ? */
export async function hasPythonModel() {
  try {
    const res = await fetch(`${BASE}${HAND_MODEL_DIR}model.json`, { method: 'HEAD' });
    return res.ok && !(res.headers.get('content-type') ?? '').includes('text/html');
  } catch {
    return false;
  }
}
