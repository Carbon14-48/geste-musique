// Ce qu'il faut savoir sur les modèles de poses sans charger TensorFlow.js (1,3 Mo) :
// la liste des poses à apprendre et la présence d'un modèle à charger.

export const LABELS_KEY = 'geste-live.pose-labels';
const BASE = import.meta.env?.BASE_URL ?? '/';

/** Poses proposées dans le panneau « Apprendre mes gestes » (étiquettes = celles des règles). */
export const TRAINABLE_POSES = [
  { label: 'fist', name: 'poing' },
  { label: 'one', name: '1 doigt' },
  { label: 'two', name: '2 doigts' },
  { label: 'three', name: '3 doigts' },
  { label: 'four', name: '4 doigts' },
  { label: 'palm', name: 'main ouverte' },
  { label: 'rock', name: 'cornes' },
  { label: 'hornsThumb', name: 'cornes + pouce' },
  { label: 'other', name: 'autre / main relâchée' },
];

/** Un modèle personnel a-t-il été entraîné dans ce navigateur ? */
export function hasSavedModel() {
  try {
    return localStorage.getItem(LABELS_KEY) !== null;
  } catch {
    return false;
  }
}

/** Le modèle entraîné en Python est-il publié dans public/models/pose/ ? */
export async function hasPythonModel() {
  try {
    const res = await fetch(`${BASE}models/pose/model.json`, { method: 'HEAD' });
    return res.ok && !(res.headers.get('content-type') ?? '').includes('text/html');
  } catch {
    return false;
  }
}
