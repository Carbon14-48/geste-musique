// Reconnaissance des poses statiques par règles géométriques (sections 2 et 8 du catalogue).
// Les angles sont calculés sur les points 3D « monde » (insensibles à la perspective),
// les directions (pouce levé / baissé) sur les points image.

import { LM, FINGERS, angleBetween, sub, dist, dist2d } from './landmarks.js';

export const DEFAULT_THRESHOLDS = {
  // Somme des angles aux 3 articulations d'un doigt (degrés).
  extendedBend: 70, // en dessous : doigt tendu
  foldedBend: 150, // au-dessus : doigt replié ; entre les deux : à demi plié
  thumbBend: 60, // pouce tendu si sa courbure est plus faible
  thumbOut: 0.6, // distance bout du pouce - base de l'index / taille de la main
  pinch: 0.32, // OK / pince : bout du pouce - bout de l'index / taille
  spread: 0.32, // V : écart bout index - bout majeur / taille
  openSpread: 0.3, // main ouverte : écart moyen entre bouts voisins (sans le pouce) / taille
};

export const POSE_LABELS = [
  'none', 'fist', 'one', 'two', 'peace', 'three', 'four', 'palm', 'open',
  'like', 'dislike', 'rock', 'call', 'gun', 'ok', 'claw', 'other',
];

export const POSE_NAMES = {
  none: '—',
  fist: 'Poing',
  one: '1 doigt',
  two: '2 doigts',
  peace: 'V / paix',
  three: '3 doigts',
  four: '4 doigts',
  palm: 'Paume (stop)',
  open: 'Main ouverte',
  like: 'Pouce levé',
  dislike: 'Pouce baissé',
  rock: 'Rock',
  call: 'Appel',
  gun: 'Pistolet',
  ok: 'OK',
  claw: 'Griffe',
  other: 'Autre',
};

function fingerBend(world, chain) {
  // Pour les doigts longs on inclut l'articulation de la base (poignet -> MCP -> PIP).
  const pts = chain[0] === 1 ? chain.map((i) => world[i]) : [world[LM.WRIST], ...chain.map((i) => world[i])];
  let total = 0;
  for (let k = 1; k < pts.length - 1; k++) {
    total += angleBetween(sub(pts[k], pts[k - 1]), sub(pts[k + 1], pts[k]));
  }
  return total;
}

/**
 * État de chaque doigt : 'up' | 'half' | 'down'.
 * @param {{x,y,z}[]} world
 */
export function fingerStates(world, th = DEFAULT_THRESHOLDS) {
  const size = Math.max(dist(world[LM.WRIST], world[LM.MIDDLE_MCP]), 1e-6);
  const bends = FINGERS.map((chain) => fingerBend(world, chain));
  const states = bends.map((b, i) => {
    if (i === 0) {
      const out = dist(world[LM.THUMB_TIP], world[LM.INDEX_MCP]) / size;
      const beyond = dist(world[LM.THUMB_TIP], world[LM.PINKY_MCP]) > dist(world[LM.THUMB_IP], world[LM.PINKY_MCP]);
      return out > th.thumbOut && beyond && b < th.thumbBend * 1.5 ? 'up' : 'down';
    }
    if (b < th.extendedBend) return 'up';
    if (b > th.foldedBend) return 'down';
    return 'half';
  });
  return { states, bends };
}

/** Paume tournée vers la caméra ? (points image non miroir + étiquette MediaPipe brute). */
export function palmFacingCamera(image, handednessLabel) {
  const v1 = sub(image[LM.INDEX_MCP], image[LM.WRIST]);
  const v2 = sub(image[LM.PINKY_MCP], image[LM.WRIST]);
  const z = v1.x * v2.y - v1.y * v2.x;
  return handednessLabel === 'Left' ? z > 0 : z < 0;
}

/**
 * Classe la pose d'une main.
 * @returns {{label:string, count:number, fingers:boolean[], states:string[], bends:number[], pinch:number, spread:number}}
 */
export function classifyPose(world, image, th = DEFAULT_THRESHOLDS) {
  const { states, bends } = fingerStates(world, th);
  const fingers = states.map((s) => s === 'up');
  const count = fingers.filter(Boolean).length;
  const size = Math.max(dist(world[LM.WRIST], world[LM.MIDDLE_MCP]), 1e-6);
  const pinch = dist(world[LM.THUMB_TIP], world[LM.INDEX_TIP]) / size;
  const spread = dist(world[LM.INDEX_TIP], world[LM.MIDDLE_TIP]) / size;
  const key = fingers.map((f) => (f ? 1 : 0)).join('');
  const halfCount = states.slice(1).filter((s) => s === 'half').length;

  let label = 'other';
  if (halfCount >= 3 && count <= 1) {
    label = 'claw';
  } else if (pinch < th.pinch && fingers[2] && fingers[3] && fingers[4]) {
    label = 'ok';
  } else if (count === 0) {
    label = 'fist';
  } else if (key === '10000') {
    const v = sub(image[LM.THUMB_TIP], image[LM.THUMB_MCP]);
    const len = Math.max(dist2d(image[LM.THUMB_TIP], image[LM.THUMB_MCP]), 1e-6);
    const dy = v.y / len; // y image vers le bas
    label = dy < -0.6 ? 'like' : dy > 0.6 ? 'dislike' : 'other';
  } else if (key === '01001') {
    label = 'rock';
  } else if (key === '10001') {
    label = 'call';
  } else if (key === '11000') {
    label = 'gun';
  } else if (key === '01000') {
    label = 'one';
  } else if (key === '01100') {
    label = spread > th.spread ? 'peace' : 'two';
  } else if (key === '01110' || key === '11100') {
    label = 'three';
  } else if (key === '01111') {
    label = 'four';
  } else if (key === '11111') {
    // Écart entre bouts voisins, sans le pouce (souvent un peu sorti même paume serrée).
    const tips = [LM.INDEX_TIP, LM.MIDDLE_TIP, LM.RING_TIP, LM.PINKY_TIP];
    let s = 0;
    for (let k = 1; k < tips.length; k++) s += dist(world[tips[k]], world[tips[k - 1]]);
    label = s / (tips.length - 1) / size > th.openSpread ? 'open' : 'palm';
  }
  return { label, count, fingers, states, bends, pinch, spread };
}

/** Ouverture de la main : moyenne des distances bout des doigts - poignet, en tailles de main. */
export function openness(world) {
  const size = Math.max(dist(world[LM.WRIST], world[LM.MIDDLE_MCP]), 1e-6);
  const tips = [LM.THUMB_TIP, LM.INDEX_TIP, LM.MIDDLE_TIP, LM.RING_TIP, LM.PINKY_TIP];
  return tips.reduce((s, i) => s + dist(world[i], world[LM.WRIST]), 0) / tips.length / size;
}

/** Combinaisons de doigts confortables et bien distinctes pour le mode binaire (pouce..auriculaire). */
export const RELIABLE_COMBOS = [
  '01000', '01100', '01110', '01111', '11111',
  '10000', '11000', '11100', '11110',
  '01001', '10001', '11001',
];
