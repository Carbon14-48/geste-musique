import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// L'utilisateur final ne sait pas ce qu'est TensorFlow, MediaPipe, un modèle ou une précision :
// ces mots ne doivent jamais apparaître dans les pages, seulement dans le code et les commentaires.
const JARGON = [
  /TensorFlow/i,
  /TF\.js/i,
  /tfjs/i,
  /modèle/i,
  /règles géométriques/i,
  /MediaPipe/i,
  /KNN/i,
  /\bPython\b/i,
  /backend/i,
  /IndexedDB/i,
  /précision/i,
  /\bepoch/i,
  /réseau/i,
  /entraîn/i,
];

const root = fileURLToPath(new URL('..', import.meta.url));

describe('vocabulaire des pages', () => {
  for (const page of ['index.html', 'studio.html']) {
    it(`${page} ne contient aucun terme technique`, () => {
      const html = readFileSync(new URL(page, `file://${root}`), 'utf8');
      for (const pattern of JARGON) {
        expect(html, `"${pattern}" trouvé dans ${page}`).not.toMatch(pattern);
      }
    });
  }
});
