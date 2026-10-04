// Sortie MIDI (Web MIDI API) : transforme Geste Musique en contrôleur pour Ableton, FL Studio, GarageBand...

export const DRUM_NOTES = { kick: 36, snare: 38, clap: 39, hihat: 42, shaker: 70, cymbal: 49 };

export class MidiOut {
  constructor() {
    this.access = null;
    this.output = null;
    this.channel = 0;
    this.drumChannel = 9;
    this.active = new Set();
  }

  get supported() {
    return typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;
  }

  async init() {
    if (!this.supported) return [];
    try {
      this.access = await navigator.requestMIDIAccess();
    } catch {
      this.access = null;
      return [];
    }
    return this.outputs();
  }

  outputs() {
    if (!this.access) return [];
    return [...this.access.outputs.values()].map((o) => ({ id: o.id, name: o.name }));
  }

  select(id) {
    this.allNotesOff();
    this.output = id && this.access ? this.access.outputs.get(id) ?? null : null;
  }

  send(bytes) {
    if (this.output) this.output.send(bytes);
  }

  noteOn(note, velocity = 0.8, channel = this.channel) {
    const n = Math.max(0, Math.min(127, Math.round(note)));
    this.send([0x90 | channel, n, Math.max(1, Math.min(127, Math.round(velocity * 127)))]);
    this.active.add(`${channel}:${n}`);
  }

  noteOff(note, channel = this.channel) {
    const n = Math.max(0, Math.min(127, Math.round(note)));
    this.send([0x80 | channel, n, 0]);
    this.active.delete(`${channel}:${n}`);
  }

  drum(pad, velocity = 0.8) {
    const note = DRUM_NOTES[pad];
    if (note === undefined) return;
    this.noteOn(note, velocity, this.drumChannel);
    setTimeout(() => this.noteOff(note, this.drumChannel), 80);
  }

  /** Contrôleur continu (0..1). */
  cc(controller, value, channel = this.channel) {
    this.send([0xb0 | channel, controller, Math.max(0, Math.min(127, Math.round(value * 127)))]);
  }

  /** Pitch bend (-1..1). */
  pitchBend(value, channel = this.channel) {
    const v = Math.max(0, Math.min(16383, Math.round((value + 1) * 8191.5)));
    this.send([0xe0 | channel, v & 0x7f, v >> 7]);
  }

  allNotesOff() {
    for (const key of this.active) {
      const [ch, n] = key.split(':').map(Number);
      this.send([0x80 | ch, n, 0]);
    }
    this.active.clear();
    for (let ch = 0; ch < 16; ch++) this.send([0xb0 | ch, 123, 0]);
  }
}
