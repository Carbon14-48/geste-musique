// Indices des 21 points MediaPipe Hands et fonctions de normalisation.
// IMPORTANT : normalizePose() et frameFeatures() doivent rester identiques à
// training/common.py (vérifié par shared/normalize_fixture.json dans les deux suites de tests).

export const LM = {
  WRIST: 0,
  THUMB_CMC: 1, THUMB_MCP: 2, THUMB_IP: 3, THUMB_TIP: 4,
  INDEX_MCP: 5, INDEX_PIP: 6, INDEX_DIP: 7, INDEX_TIP: 8,
  MIDDLE_MCP: 9, MIDDLE_PIP: 10, MIDDLE_DIP: 11, MIDDLE_TIP: 12,
  RING_MCP: 13, RING_PIP: 14, RING_DIP: 15, RING_TIP: 16,
  PINKY_MCP: 17, PINKY_PIP: 18, PINKY_DIP: 19, PINKY_TIP: 20,
};

// Chaînes d'articulations par doigt : [base, ..., bout].
export const FINGERS = [
  [1, 2, 3, 4], // pouce
  [5, 6, 7, 8], // index
  [9, 10, 11, 12], // majeur
  [13, 14, 15, 16], // annulaire
  [17, 18, 19, 20], // auriculaire
];

export const FINGER_NAMES = ['pouce', 'index', 'majeur', 'annulaire', 'auriculaire'];

// Segments pour dessiner le squelette.
export const CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
];

export const POSE_DIM = 63;
export const FRAME_DIM = 67;

export function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: (a.z ?? 0) - (b.z ?? 0) };
}

export function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = (a.z ?? 0) - (b.z ?? 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function dist2d(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function norm(v) {
  return Math.sqrt(v.x * v.x + v.y * v.y + (v.z ?? 0) * (v.z ?? 0));
}

/** Angle en degrés entre deux vecteurs. */
export function angleBetween(u, v) {
  const nu = norm(u);
  const nv = norm(v);
  if (nu < 1e-9 || nv < 1e-9) return 0;
  const c = (u.x * v.x + u.y * v.y + (u.z ?? 0) * (v.z ?? 0)) / (nu * nv);
  return (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI;
}

/** Taille de référence de la main : poignet -> base du majeur. */
export function handSize(points) {
  return dist(points[LM.WRIST], points[LM.MIDDLE_MCP]);
}

/**
 * Vecteur de pose (63 valeurs) invariant à la position, à la distance et à la main (gauche/droite).
 * - translation : poignet à l'origine
 * - échelle : divisé par |poignet -> base du majeur|
 * - miroir : x inversé quand MediaPipe annonce « Left », pour que les deux mains partagent un modèle
 * Pas de rotation : « pouce levé » et « pouce baissé » doivent rester distincts.
 * @param {{x:number,y:number,z:number}[]} world points 3D (worldLandmarks)
 * @param {string} handednessLabel étiquette brute MediaPipe ("Left" ou "Right")
 */
export function normalizePose(world, handednessLabel) {
  const w = world[LM.WRIST];
  let s = handSize(world);
  if (s < 1e-6) s = 1;
  const flip = handednessLabel === 'Left' ? -1 : 1;
  const out = new Array(POSE_DIM);
  for (let i = 0; i < 21; i++) {
    const p = world[i];
    out[i * 3] = ((p.x - w.x) / s) * flip;
    out[i * 3 + 1] = (p.y - w.y) / s;
    out[i * 3 + 2] = ((p.z ?? 0) - (w.z ?? 0)) / s;
  }
  return out;
}

/**
 * Caractéristiques d'une image pour le modèle dynamique (67 valeurs) :
 * 63 de pose + déplacement du poignet (dx, dy) en tailles de main + log(échelle) + présence.
 * @param {object|null} hand {world, image, handedness} ou null si pas de main
 * @param {{x:number,y:number,size:number}} ref position et taille du poignet à la 1re image de la fenêtre
 */
export function frameFeatures(hand, ref) {
  if (!hand || !ref) return new Array(FRAME_DIM).fill(0);
  const pose = normalizePose(hand.world, hand.handedness);
  const wrist = hand.image[LM.WRIST];
  const size = Math.max(dist2d(hand.image[LM.WRIST], hand.image[LM.MIDDLE_MCP]), 1e-6);
  const refSize = Math.max(ref.size, 1e-6);
  return [
    ...pose,
    (wrist.x - ref.x) / refSize,
    (wrist.y - ref.y) / refSize,
    Math.log(size / refSize),
    1,
  ];
}

/** Référence (position/taille du poignet) pour frameFeatures. */
export function frameRef(hand) {
  if (!hand) return null;
  return {
    x: hand.image[LM.WRIST].x,
    y: hand.image[LM.WRIST].y,
    size: dist2d(hand.image[LM.WRIST], hand.image[LM.MIDDLE_MCP]),
  };
}

/** Transforme une séquence de mains (ou null) en matrice [T][67]. */
export function sequenceFeatures(hands) {
  const first = hands.find((h) => h);
  const ref = frameRef(first);
  return hands.map((h) => frameFeatures(h, ref));
}

/** Rééchantillonne une liste horodatée [{t, hand}] en exactement n éléments (plus proche voisin). */
export function resampleByTime(frames, n) {
  if (frames.length === 0) return new Array(n).fill(null);
  const t0 = frames[0].t;
  const t1 = frames[frames.length - 1].t;
  const out = [];
  let j = 0;
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? t1 : t0 + ((t1 - t0) * i) / (n - 1);
    while (j < frames.length - 1 && Math.abs(frames[j + 1].t - t) <= Math.abs(frames[j].t - t)) j++;
    out.push(frames[j].hand);
  }
  return out;
}
