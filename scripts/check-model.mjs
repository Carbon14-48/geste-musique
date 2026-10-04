// Vérifie qu'un modèle exporté par training/ se charge dans TensorFlow.js et donne de bons résultats
// avec les caractéristiques calculées par le code JavaScript de l'application.
// Usage : node scripts/check-model.mjs <dossier du modèle> <dataset.json> pose|dynamic
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as tf from '@tensorflow/tfjs';
import { normalizePose, resampleByTime, sequenceFeatures } from '../src/core/landmarks.js';

const [dir, datasetPath, kind = 'pose'] = process.argv.slice(2);
if (!dir || !datasetPath) {
  console.error('Usage : node scripts/check-model.mjs <dossier> <dataset.json> pose|dynamic');
  process.exit(1);
}
await tf.setBackend('cpu');
const modelJson = JSON.parse(readFileSync(join(dir, 'model.json')));
const { labels } = JSON.parse(readFileSync(join(dir, 'labels.json')));
const weightData = readFileSync(join(dir, modelJson.weightsManifest[0].paths[0]));
const model = await tf.loadLayersModel(
  tf.io.fromMemory({
    modelTopology: modelJson.modelTopology,
    weightSpecs: modelJson.weightsManifest[0].weights,
    weightData: weightData.buffer.slice(weightData.byteOffset, weightData.byteOffset + weightData.byteLength),
  }),
);

const toPts = (arr) => arr.map(([x, y, z]) => ({ x, y, z }));
const toHand = (h) => (h ? { handedness: h.handedness, world: toPts(h.world), image: toPts(h.image) } : null);
const data = JSON.parse(readFileSync(datasetPath));
let X;
let y;
if (kind === 'pose') {
  X = tf.tensor2d(data.poses.map((p) => normalizePose(toPts(p.world), p.handedness)));
  y = data.poses.map((p) => p.label);
} else {
  const steps = model.inputs[0].shape[1];
  X = tf.tensor3d(data.sequences.map((s) => sequenceFeatures(resampleByTime(s.frames.map((f) => ({ t: f.t, hand: toHand(f.hand) })), steps))));
  y = data.sequences.map((s) => s.label);
}
const pred = model.predict(X).argMax(-1).arraySync();
const known = y.map((l, i) => [l, i]).filter(([l]) => labels.includes(l));
const correct = known.filter(([l, i]) => labels[pred[i]] === l).length;
const acc = correct / known.length;
console.log(`${kind} : ${model.countParams()} paramètres, ${known.length} exemples, précision TF.js = ${(acc * 100).toFixed(1)} %`);
process.exit(acc > 0.9 ? 0 : 1);
