// Prépare les fichiers servis localement : le moteur WebAssembly de MediaPipe et le modèle
// hand_landmarker.task. Sans eux, l'application se rabat sur les CDN (jsDelivr / Google).
import { cp, mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const wasmSrc = join(root, 'node_modules/@mediapipe/tasks-vision/wasm');
const wasmDst = join(root, 'public/mediapipe/wasm');
const modelDst = join(root, 'public/models/hand_landmarker.task');
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

const exists = (p) => stat(p).then(() => true, () => false);

if (await exists(wasmSrc)) {
  await mkdir(wasmDst, { recursive: true });
  await cp(wasmSrc, wasmDst, { recursive: true });
  console.log('✔ WebAssembly MediaPipe copié dans public/mediapipe/wasm');
}

if (!(await exists(modelDst))) {
  try {
    const res = await fetch(MODEL_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await mkdir(dirname(modelDst), { recursive: true });
    await writeFile(modelDst, Buffer.from(await res.arrayBuffer()));
    console.log('✔ Modèle hand_landmarker.task téléchargé dans public/models/');
  } catch (err) {
    console.warn(`⚠ Téléchargement du modèle impossible (${err.message}) : l'application utilisera l'URL distante.`);
  }
}
