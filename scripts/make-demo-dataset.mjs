// Crée un petit jeu de données synthétique (même format que l'export de l'onglet « Données »)
// pour tester toute la chaîne d'entraînement sans télécharger HaGRID ni Jester.
// Usage : node scripts/make-demo-dataset.mjs [training/data/demo_dataset.json]
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { synthHand } from '../tests/helpers/synthHand.js';

const out = process.argv[2] ?? 'training/data/demo_dataset.json';
let seed = 7;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31) - 0.5;
const jitter = (pts, k) => pts.map((p) => [p.x + rand() * k, p.y + rand() * k, (p.z ?? 0) + rand() * k]);

const U = 'up';
const D = 'down';
const H = 'half';
const POSES = {
  fist: [[D, D, D, D, D]],
  one: [[D, U, D, D, D]],
  two: [[D, U, U, D, D]],
  peace: [[D, U, U, D, D], { tilts: [0, -18, 18, 0, 0] }],
  three: [[D, U, U, U, D]],
  palm: [[U, U, U, U, U]],
  open: [[U, U, U, U, U], { tilts: [0, -25, -8, 8, 25] }],
  rock: [[D, U, D, D, U]],
  claw: [[D, H, H, H, H]],
};

const poses = [];
for (const subject of ['alice', 'bilal', 'chloe', 'driss', 'emma']) {
  for (const [label, [states, opts = {}]] of Object.entries(POSES)) {
    for (let i = 0; i < 40; i++) {
      const h = synthHand(states, { ...opts, rotateDeg: rand() * 30 });
      const handedness = i % 2 ? 'Left' : 'Right';
      const world = jitter(h.world, 0.006).map(([x, y, z]) => [handedness === 'Left' ? -x : x, y, z]);
      poses.push({ label, subject, handedness, world, image: jitter(h.image, 0.004) });
    }
  }
}

const sequences = [];
const motions = { swipe_left: [-0.6, 0], swipe_right: [0.6, 0], swipe_up: [0, -0.5], none: [0, 0] };
for (const subject of ['alice', 'bilal', 'chloe', 'driss', 'emma']) {
  for (const [label, [vx, vy]] of Object.entries(motions)) {
    for (let k = 0; k < 15; k++) {
      const frames = [];
      for (let i = 0; i < 45; i++) {
        const s = Math.min(1, Math.max(0, (i - 10) / 20));
        const h = synthHand([U, U, U, U, U], { rotateDeg: rand() * 10 });
        const dx = vx * s + rand() * 0.02;
        const dy = vy * s + rand() * 0.02;
        frames.push({
          t: i * 33,
          hand: {
            handedness: 'Left',
            world: jitter(h.world, 0.004),
            image: h.image.map((p) => [p.x - 0.2 + dx * 0.6 + 0.2, p.y + dy * 0.6, p.z]),
          },
        });
      }
      sequences.push({ label, subject, frames });
    }
  }
}

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ format: 'geste-musique-dataset', version: 1, poses, sequences }));
console.log(`✔ ${poses.length} poses et ${sequences.length} séquences écrites dans ${out}`);
