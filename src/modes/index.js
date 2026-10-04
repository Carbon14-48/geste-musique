import notes from './notes.js';
import binary from './binary.js';
import theremin from './theremin.js';
import piano from './piano.js';
import drums from './drums.js';
import guitar from './guitar.js';
import dj from './dj.js';
import custom from './custom.js';

export const MODES = [notes, binary, theremin, piano, drums, guitar, dj, custom];

export function findMode(id) {
  return MODES.find((m) => m.id === id) ?? MODES[0];
}
