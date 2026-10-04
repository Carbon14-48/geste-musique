// Looper : enregistrement et superposition de boucles (feuille de route, étape 4).
// La première couche fixe la longueur de la boucle, les suivantes s'y superposent.

import * as Tone from 'tone';

export class Looper {
  constructor(engine) {
    this.engine = engine;
    this.layers = []; // {part, events}
    this.length = 0;
    this.recording = null; // {start, events}
    this.playing = false;
    this.unsubscribe = engine.on((e) => this.capture(e));
  }

  get transport() {
    return Tone.getTransport();
  }

  capture(e) {
    if (!this.recording || e.kind === 'stop' || e.kind === 'instrument') return;
    let time;
    if (this.layers.length === 0) time = e.at - this.recording.start;
    else time = this.transport.seconds % this.length;
    this.recording.events.push({ ...e, time, instrument: this.engine.instrument });
  }

  /** Démarre ou arrête l'enregistrement d'une couche. @returns {'recording'|'playing'|'idle'} */
  toggleRecord() {
    if (!this.engine.ready) return 'idle';
    if (!this.recording) {
      this.recording = { start: Tone.now(), events: [] };
      if (this.layers.length > 0 && !this.playing) this.play();
      return 'recording';
    }
    const rec = this.recording;
    this.recording = null;
    if (this.layers.length === 0) {
      this.length = Math.max(0.5, Tone.now() - rec.start);
      this.transport.loop = true;
      this.transport.loopStart = 0;
      this.transport.loopEnd = this.length;
    }
    if (rec.events.length) this.addLayer(rec.events);
    if (!this.playing && this.layers.length) this.play();
    return this.layers.length ? 'playing' : 'idle';
  }

  addLayer(events) {
    const part = new Tone.Part((time, ev) => this.replay(ev, time), events.map((e) => [e.time, e]));
    part.loop = true;
    part.loopEnd = this.length;
    part.start(0);
    this.layers.push({ part, events });
  }

  replay(ev, time) {
    const e = this.engine;
    const opts = { silent: true, time };
    const prev = e.instrument;
    if (ev.instrument && ev.instrument !== prev) e.instrument = ev.instrument;
    switch (ev.kind) {
      case 'noteOn':
        e.playNote(ev.note, 0.5, ev.velocity, opts);
        break;
      case 'note':
        e.playNote(ev.note, ev.duration, ev.velocity, opts);
        break;
      case 'strum':
        e.strum(ev.notes, ev.dir, ev.velocity, opts);
        break;
      case 'drum':
        e.drum(ev.pad, ev.velocity, opts);
        break;
      default:
        break;
    }
    e.instrument = prev;
  }

  play() {
    if (!this.layers.length) return;
    this.transport.start();
    this.playing = true;
  }

  stop() {
    this.transport.stop();
    this.playing = false;
    this.engine.releaseAll();
  }

  /** Supprime la dernière couche. */
  undo() {
    const layer = this.layers.pop();
    if (layer) layer.part.dispose();
    if (!this.layers.length) this.clear();
  }

  clear() {
    for (const l of this.layers) l.part.dispose();
    this.layers = [];
    this.recording = null;
    this.length = 0;
    this.stop();
  }

  status() {
    if (this.recording) return `● enregistrement (couche ${this.layers.length + 1})`;
    if (this.playing) return `▶ ${this.layers.length} couche(s), ${this.length.toFixed(1)} s`;
    return this.layers.length ? `⏸ ${this.layers.length} couche(s)` : 'vide';
  }
}
