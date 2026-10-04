// Capture des notes jouées pendant une session pour l'export en fichier .mid.

import { DRUM_NOTES } from './midi.js';
import { encodeMidiFile } from './midiFile.js';

export class MidiCapture {
  constructor(engine) {
    this.events = [];
    this.start = null;
    engine.on((e) => this.capture(e));
  }

  begin(now) {
    this.events = [];
    this.start = now;
  }

  end() {
    const events = this.events;
    this.start = null;
    return events;
  }

  get active() {
    return this.start !== null;
  }

  capture(e) {
    if (this.start === null) return;
    const t = e.at - this.start;
    const add = (note, dur, vel, channel = 0) => {
      this.events.push({ time: t, type: 'on', note, velocity: vel, channel });
      this.events.push({ time: t + dur, type: 'off', note, channel });
    };
    if (e.kind === 'noteOn') this.events.push({ time: t, type: 'on', note: e.note, velocity: e.velocity, channel: 0 });
    else if (e.kind === 'noteOff') this.events.push({ time: t, type: 'off', note: e.note, channel: 0 });
    else if (e.kind === 'note') add(e.note, e.duration, e.velocity);
    else if (e.kind === 'strum') e.notes.forEach((n) => add(n, 0.8, e.velocity));
    else if (e.kind === 'drum') add(DRUM_NOTES[e.pad], 0.1, e.velocity, 9);
  }

  toFile(events, bpm = 120) {
    return encodeMidiFile(events, bpm);
  }
}
