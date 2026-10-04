// Écriture d'un fichier MIDI standard (format 0) à partir des notes jouées.

function varLen(value) {
  let v = Math.max(0, Math.round(value));
  const bytes = [v & 0x7f];
  v >>= 7;
  while (v > 0) {
    bytes.unshift((v & 0x7f) | 0x80);
    v >>= 7;
  }
  return bytes;
}

/**
 * @param {{time:number, type:'on'|'off', note:number, velocity?:number, channel?:number}[]} events time en secondes
 * @param {number} bpm
 * @returns {Uint8Array}
 */
export function encodeMidiFile(events, bpm = 120) {
  const ppq = 480;
  const ticksPerSecond = (ppq * bpm) / 60;
  const sorted = [...events].sort((a, b) => a.time - b.time || (a.type === 'off' ? -1 : 1));
  const track = [];
  const tempo = Math.round(60000000 / bpm);
  track.push(0x00, 0xff, 0x51, 0x03, (tempo >> 16) & 0xff, (tempo >> 8) & 0xff, tempo & 0xff);
  let lastTick = 0;
  for (const e of sorted) {
    const tick = Math.round(e.time * ticksPerSecond);
    track.push(...varLen(tick - lastTick));
    lastTick = tick;
    const ch = (e.channel ?? 0) & 0x0f;
    const note = Math.max(0, Math.min(127, Math.round(e.note)));
    if (e.type === 'on') {
      track.push(0x90 | ch, note, Math.max(1, Math.min(127, Math.round((e.velocity ?? 0.8) * 127))));
    } else {
      track.push(0x80 | ch, note, 0);
    }
  }
  track.push(0x00, 0xff, 0x2f, 0x00);

  const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, (ppq >> 8) & 0xff, ppq & 0xff];
  const len = track.length;
  const trackHeader = [0x4d, 0x54, 0x72, 0x6b, (len >> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff];
  return new Uint8Array([...header, ...trackHeader, ...track]);
}
