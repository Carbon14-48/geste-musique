// Génère shared/normalize_fixture.json : des entrées et les sorties attendues de la normalisation JS.
// Les tests Python (training/test_common.py) vérifient que training/common.py donne exactement la même chose.
import { writeFileSync } from 'node:fs';
import { normalizePose, sequenceFeatures } from '../src/core/landmarks.js';
import { synthHand } from '../tests/helpers/synthHand.js';

let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31) - 0.5;
const jitter = (pts, k) => pts.map((p) => ({ x: p.x + rand() * k, y: p.y + rand() * k, z: p.z + rand() * k }));
const arr = (pts) => pts.map((p) => [p.x, p.y, p.z]);

const shapes = [['up', 'up', 'up', 'up', 'up'], ['down', 'up', 'up', 'down', 'down'], ['up', 'down', 'down', 'down', 'up']];
const cases = shapes.flatMap((s, i) =>
  ['Left', 'Right'].map((handedness) => {
    const world = jitter(synthHand(s, { rotateDeg: i * 20 }).world, 0.004);
    return { handedness, world: arr(world), pose: normalizePose(world, handedness) };
  }),
);

const frames = Array.from({ length: 6 }, (_, i) => {
  if (i === 3) return null;
  const h = synthHand(['up', 'up', 'up', 'up', 'up'], { rotateDeg: i * 5 });
  const image = jitter(h.image.map((p) => ({ ...p, x: p.x + i * 0.03 })), 0.002);
  return { handedness: 'Left', world: jitter(h.world, 0.003), image };
});
const features = sequenceFeatures(frames);
const sequence = {
  frames: frames.map((f) => (f ? { handedness: f.handedness, world: arr(f.world), image: arr(f.image) } : null)),
  features,
};

writeFileSync(new URL('../shared/normalize_fixture.json', import.meta.url), JSON.stringify({ cases, sequence }, null, 1));
console.log(`✔ ${cases.length} poses et 1 séquence écrites dans shared/normalize_fixture.json`);
