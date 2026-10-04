// Moteur audio Tone.js : instruments, batterie, thérémine et chaîne d'effets.
// Chaque action est aussi envoyée en MIDI et aux écouteurs (looper, enregistreur MIDI).

import * as Tone from 'tone';
import { midiToFreq } from '../core/scale.js';

export const INSTRUMENTS = {
  piano: 'Piano électrique',
  guitar: 'Guitare (cordes pincées)',
  synth: 'Synthé lead',
  organ: 'Orgue',
  bell: 'Cloches',
};

export const DRUM_PADS = ['kick', 'snare', 'hihat', 'cymbal', 'clap', 'shaker'];

export const DRUM_NAMES = {
  kick: 'Grosse caisse',
  snare: 'Caisse claire',
  hihat: 'Charleston',
  cymbal: 'Cymbale',
  clap: 'Clap',
  shaker: 'Shaker',
};

export class AudioEngine {
  constructor(midi = null) {
    this.midi = midi;
    this.ready = false;
    this.instrument = 'piano';
    this.volume = 0.8;
    this.distortionOn = false;
    this.wahOn = false;
    this.listeners = new Set();
    this.held = new Map(); // note -> instrument (notes tenues)
    this.muted = false;
  }

  async start() {
    if (this.ready) return;
    await Tone.start();
    this.build();
    this.ready = true;
  }

  build() {
    this.out = new Tone.Volume(Tone.gainToDb(this.volume)).toDestination();
    this.reverb = new Tone.Reverb({ decay: 2.5, wet: 0.2 }).connect(this.out);
    this.filter = new Tone.Filter({ type: 'lowpass', frequency: 18000, Q: 0.7 }).connect(this.reverb);
    this.wah = new Tone.AutoWah({ baseFrequency: 200, octaves: 5, sensitivity: -30, wet: 0 }).connect(this.filter);
    this.distortion = new Tone.Distortion({ distortion: 0.7, wet: 0 }).connect(this.wah);
    this.vibrato = new Tone.Vibrato({ frequency: 5, depth: 0, wet: 1 }).connect(this.distortion);
    this.input = this.vibrato;

    this.recorder = new Tone.Recorder();
    this.out.connect(this.recorder);

    const poly = (voice, options) => new Tone.PolySynth(voice, options).connect(this.input);
    this.instruments = {
      piano: poly(Tone.FMSynth, {
        harmonicity: 3,
        modulationIndex: 10,
        envelope: { attack: 0.005, decay: 0.8, sustain: 0.2, release: 1.2 },
        modulationEnvelope: { attack: 0.002, decay: 0.3, sustain: 0, release: 0.2 },
        volume: -8,
      }),
      synth: poly(Tone.Synth, {
        oscillator: { type: 'sawtooth' },
        envelope: { attack: 0.01, decay: 0.2, sustain: 0.6, release: 0.4 },
        volume: -14,
      }),
      organ: poly(Tone.AMSynth, {
        harmonicity: 2,
        envelope: { attack: 0.02, decay: 0.1, sustain: 0.9, release: 0.3 },
        volume: -10,
      }),
      bell: poly(Tone.FMSynth, {
        harmonicity: 5.1,
        modulationIndex: 20,
        envelope: { attack: 0.001, decay: 1.5, sustain: 0, release: 1.5 },
        volume: -12,
      }),
    };
    // La guitare utilise un groupe de PluckSynth (synthèse Karplus-Strong), un par corde.
    this.strings = Array.from({ length: 6 }, () =>
      new Tone.PluckSynth({ attackNoise: 1.2, dampening: 3800, resonance: 0.97, volume: -2 }).connect(this.input),
    );
    this.stringIndex = 0;

    const drumBus = new Tone.Volume(-4).connect(this.filter);
    this.drums = {
      kick: new Tone.MembraneSynth({ pitchDecay: 0.04, octaves: 6, envelope: { attack: 0.001, decay: 0.4, sustain: 0 } }).connect(drumBus),
      snare: new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.18, sustain: 0 }, volume: -6 }).connect(drumBus),
      hihat: new Tone.MetalSynth({ envelope: { attack: 0.001, decay: 0.08, release: 0.01 }, harmonicity: 5.1, modulationIndex: 32, resonance: 6000, octaves: 1.5, volume: -18 }).connect(drumBus),
      cymbal: new Tone.MetalSynth({ envelope: { attack: 0.001, decay: 1.2, release: 0.3 }, harmonicity: 5.1, modulationIndex: 40, resonance: 4000, octaves: 1.5, volume: -16 }).connect(drumBus),
      clap: new Tone.NoiseSynth({ noise: { type: 'pink' }, envelope: { attack: 0.002, decay: 0.12, sustain: 0 }, volume: -4 }).connect(drumBus),
      shaker: new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.003, decay: 0.05, sustain: 0 }, volume: -16 }).connect(
        new Tone.Filter(6000, 'highpass').connect(drumBus),
      ),
    };

    this.theremin = new Tone.MonoSynth({
      oscillator: { type: 'sine' },
      envelope: { attack: 0.05, decay: 0, sustain: 1, release: 0.3 },
      filterEnvelope: { attack: 0.01, decay: 0, sustain: 1, release: 0.3, baseFrequency: 4000, octaves: 0 },
      portamento: 0.05,
      volume: -6,
    }).connect(this.input);
    this.thereminOn = false;
  }

  on(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event) {
    for (const l of this.listeners) l({ ...event, at: Tone.now() });
  }

  setInstrument(name) {
    if (!INSTRUMENTS[name]) return;
    this.releaseAll();
    this.instrument = name;
    this.emit({ kind: 'instrument', name });
  }

  cycleInstrument(step) {
    const names = Object.keys(INSTRUMENTS);
    const i = names.indexOf(this.instrument);
    this.setInstrument(names[(i + step + names.length) % names.length]);
    return this.instrument;
  }

  pluck(midi, time) {
    const s = this.strings[this.stringIndex];
    this.stringIndex = (this.stringIndex + 1) % this.strings.length;
    s.triggerAttack(midiToFreq(midi), time ?? Tone.now());
  }

  /** Note tenue jusqu'à noteOff. `silent` : ne pas réémettre (lecture du looper). */
  noteOn(midi, velocity = 0.8, { silent = false, time } = {}) {
    if (!this.ready || this.muted) return;
    if (this.held.has(midi)) this.noteOff(midi, { silent: true, time });
    if (this.instrument === 'guitar') this.pluck(midi, time);
    else this.instruments[this.instrument].triggerAttack(midiToFreq(midi), time ?? Tone.now(), velocity);
    this.held.set(midi, this.instrument);
    this.midi?.noteOn(midi, velocity);
    if (!silent) this.emit({ kind: 'noteOn', note: midi, velocity });
  }

  noteOff(midi, { silent = false, time } = {}) {
    if (!this.ready) return;
    const inst = this.held.get(midi);
    if (inst === undefined) return;
    this.held.delete(midi);
    if (inst !== 'guitar') this.instruments[inst].triggerRelease(midiToFreq(midi), time ?? Tone.now());
    this.midi?.noteOff(midi);
    if (!silent) this.emit({ kind: 'noteOff', note: midi });
  }

  /** Note courte (durée en secondes). */
  playNote(midi, duration = 0.4, velocity = 0.8, { silent = false, time } = {}) {
    if (!this.ready || this.muted) return;
    if (this.instrument === 'guitar') this.pluck(midi, time);
    else this.instruments[this.instrument].triggerAttackRelease(midiToFreq(midi), duration, time ?? Tone.now(), velocity);
    this.midi?.noteOn(midi, velocity);
    setTimeout(() => this.midi?.noteOff(midi), duration * 1000);
    if (!silent) this.emit({ kind: 'note', note: midi, velocity, duration });
  }

  playChord(midis, duration = 0.8, velocity = 0.7, opts = {}) {
    for (const m of midis) this.playNote(m, duration, velocity, opts);
  }

  /** Grattage : les cordes partent l'une après l'autre (vers le bas = grave -> aigu). */
  strum(midis, dir = 'down', velocity = 0.8, { silent = false, time } = {}) {
    if (!this.ready || this.muted) return;
    const order = dir === 'down' ? midis : [...midis].reverse();
    const gap = 0.012 + (1 - velocity) * 0.02;
    const now = time ?? Tone.now();
    order.forEach((m, i) => {
      if (this.instrument === 'guitar') this.pluck(m, now + i * gap);
      else this.instruments[this.instrument].triggerAttackRelease(midiToFreq(m), 0.8, now + i * gap, velocity);
      this.midi?.noteOn(m, velocity);
      setTimeout(() => this.midi?.noteOff(m), 600);
    });
    if (!silent) this.emit({ kind: 'strum', notes: midis, dir, velocity });
  }

  drum(pad, velocity = 0.8, { silent = false, time } = {}) {
    if (!this.ready || this.muted) return;
    const d = this.drums[pad];
    if (!d) return;
    const now = time ?? Tone.now();
    const v = Math.max(0.05, Math.min(1, velocity));
    if (pad === 'kick') d.triggerAttackRelease('C1', '8n', now, v);
    else if (pad === 'hihat' || pad === 'cymbal') d.triggerAttackRelease(pad === 'hihat' ? 'C6' : 'C5', pad === 'hihat' ? 0.05 : 0.8, now, v);
    else d.triggerAttackRelease(pad === 'snare' ? 0.15 : 0.08, now, v);
    this.midi?.drum(pad, v);
    if (!silent) this.emit({ kind: 'drum', pad, velocity: v });
  }

  /** Thérémine : fréquence et volume continus. */
  thereminSet(midiFloat, level) {
    if (!this.ready) return;
    const freq = midiToFreq(midiFloat);
    if (level > 0.02 && !this.muted) {
      if (!this.thereminOn) {
        this.theremin.triggerAttack(freq);
        this.thereminOn = true;
      } else {
        this.theremin.frequency.rampTo(freq, 0.03);
      }
      this.theremin.volume.rampTo(Tone.gainToDb(Math.max(level, 0.001)) - 6, 0.05);
    } else if (this.thereminOn) {
      this.thereminOff();
    }
  }

  thereminOff() {
    if (!this.ready || !this.thereminOn) return;
    this.theremin.triggerRelease();
    this.thereminOn = false;
  }

  releaseAll() {
    if (!this.ready) return;
    for (const inst of Object.values(this.instruments)) inst.releaseAll();
    for (const m of [...this.held.keys()]) this.noteOff(m, { silent: true });
    this.held.clear();
    this.thereminOff();
  }

  /** STOP : coupe tous les sons immédiatement. */
  stopAll() {
    this.releaseAll();
    this.midi?.allNotesOff();
    this.emit({ kind: 'stop' });
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.ready) this.out.volume.rampTo(this.volume <= 0.001 ? -Infinity : Tone.gainToDb(this.volume), 0.05);
    this.midi?.cc(7, this.volume);
    return this.volume;
  }

  volumeStep(delta) {
    return this.setVolume(this.volume + delta);
  }

  setDistortion(on) {
    this.distortionOn = on;
    if (this.ready) this.distortion.wet.rampTo(on ? 1 : 0, 0.05);
    return on;
  }

  setWah(on) {
    this.wahOn = on;
    if (this.ready) this.wah.wet.rampTo(on ? 1 : 0, 0.05);
    return on;
  }

  /** Brillance (0..1) -> fréquence de coupure du passe-bas, échelle logarithmique. */
  setBrightness(x) {
    const v = Math.max(0, Math.min(1, x));
    if (this.ready) this.filter.frequency.rampTo(200 * 90 ** v, 0.05);
    this.midi?.cc(74, v);
  }

  setReverb(x) {
    const v = Math.max(0, Math.min(1, x));
    if (this.ready) this.reverb.wet.rampTo(v, 0.1);
    this.midi?.cc(91, v);
  }

  setVibrato(x) {
    const v = Math.max(0, Math.min(1, x));
    if (this.ready) this.vibrato.depth.rampTo(v * 0.5, 0.05);
    this.midi?.cc(1, v);
  }

  startRecording() {
    if (!this.ready || this.recorder.state === 'started') return false;
    this.recorder.start();
    return true;
  }

  /** @returns {Promise<Blob|null>} */
  async stopRecording() {
    if (!this.ready || this.recorder.state !== 'started') return null;
    return this.recorder.stop();
  }

  get recording() {
    return this.ready && this.recorder.state === 'started';
  }

  now() {
    return Tone.now();
  }
}
