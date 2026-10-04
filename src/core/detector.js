// Détection des mains avec MediaPipe Hand Landmarker (tasks-vision).
// C'est le même modèle que celui utilisé par les scripts Python d'entraînement,
// ce qui garantit que les points vus à l'entraînement ressemblent à ceux du jeu.

import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

const BASE = import.meta.env?.BASE_URL ?? '/';
const VERSION = '1.0.1';
const LOCAL_WASM = `${BASE}mediapipe/wasm`;
const CDN_WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/wasm`;
const LOCAL_MODEL = `${BASE}models/hand_landmarker.task`;
export const REMOTE_MODEL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

async function available(url) {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    return res.ok && !(res.headers.get('content-type') ?? '').includes('text/html');
  } catch {
    return false;
  }
}

export class HandDetector {
  constructor() {
    this.landmarker = null;
    this.delegate = null;
    this.lastTimestamp = 0;
  }

  async init({ numHands = 2 } = {}) {
    const wasm = (await available(`${LOCAL_WASM}/vision_wasm_internal.wasm`)) ? LOCAL_WASM : CDN_WASM;
    const model = (await available(LOCAL_MODEL)) ? LOCAL_MODEL : REMOTE_MODEL;
    const fileset = await FilesetResolver.forVisionTasks(wasm);
    const options = (delegate) => ({
      baseOptions: { modelAssetPath: model, delegate },
      runningMode: 'VIDEO',
      numHands,
      minHandDetectionConfidence: 0.6,
      minHandPresenceConfidence: 0.6,
      minTrackingConfidence: 0.5,
    });
    try {
      this.landmarker = await HandLandmarker.createFromOptions(fileset, options('GPU'));
      this.delegate = 'GPU';
    } catch {
      this.landmarker = await HandLandmarker.createFromOptions(fileset, options('CPU'));
      this.delegate = 'CPU';
    }
    return { wasm, model, delegate: this.delegate };
  }

  /** @param {HTMLVideoElement} video @param {number} t ms (strictement croissant) */
  detect(video, t) {
    if (!this.landmarker) return null;
    const ts = Math.max(t, this.lastTimestamp + 1);
    this.lastTimestamp = ts;
    return this.landmarker.detectForVideo(video, ts);
  }
}
