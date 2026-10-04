// Graphe audio de Geste Live (Tone.js) :
// nappe d'accords -> filtre -> trémolo -> grain -> chorus ┐
// batterie -> filtre ───────────────────────────────────┤
// basse -> « ducking » par la grosse caisse ────────────┼─> bus -> bitcrush -> stutter -> delay -> réverb -> limiteur -> sortie
// 4 voix mélodiques -> filtre ───────────────────────────┘                                                   └─> enregistrement

import * as Tone from 'tone';
import { drumBar, bassStep, DRUM_FAMILIES } from './patterns.js';
import { SAMPLE_BASE, instrumentInfo, sampleUrls } from './instruments.js';

export const BANKS = { pad: 'Nappe', keys: 'Keys (FM)', hollow: 'Hollow (pulse)' };
export const LEAD_VOICES = ['saw', 'square', 'flûte', 'verre'];

const ARP_RATES = [null, '4n', '8n', '16n', '32n'];

function makePad(bank) {
  if (bank === 'keys') {
    return new Tone.PolySynth(Tone.FMSynth, {
      harmonicity: 3,
      modulationIndex: 8,
      envelope: { attack: 0.005, decay: 1.2, sustain: 0.35, release: 1.4 },
      modulationEnvelope: { attack: 0.002, decay: 0.4, sustain: 0.1, release: 0.4 },
      volume: -12,
    });
  }
  if (bank === 'hollow') {
    return new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'pulse', width: 0.3 },
      envelope: { attack: 0.08, decay: 0.3, sustain: 0.7, release: 1.2 },
      volume: -20,
    });
  }
  return new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'fatsawtooth', count: 3, spread: 24 },
    envelope: { attack: 0.35, decay: 0.4, sustain: 0.8, release: 1.6 },
    volume: -20,
  });
}

export class LiveAudio {
  constructor() {
    this.ready = false;
    this.bank = 'pad';
    this.chordNotes = [];
    this.arpRate = null;
    this.arpIndex = 0;
    this.step = 0;
    this.bar = 0;
    this.drumLevels = [0, 0, 0, 0];
    this.bassParams = { density: 0, tones: 0, octave: 0, feel: 0 };
    this.chord = null; // accord courant pour la basse
    this.envelope = 0;
    this.onStep = null; // (step, bar) pour l'affichage
    this.leadNotes = [null, null, null, null];
    this.instrument = 'piano';
    this.samplers = {}; // id -> Promise<{chord, lead}>
    this.leadSampler = null; // instrument enregistré utilisé par la mélodie (sinon voix de synthèse)
    this.muted = false;
  }

  get transport() {
    return Tone.getTransport();
  }

  async start(bpm = 100, instrument = this.instrument) {
    if (this.ready) return;
    await Tone.start();
    const ctx = Tone.getContext();
    ctx.lookAhead = 0.05;

    this.out = new Tone.Limiter(-1).toDestination();
    this.recordDest = ctx.rawContext.createMediaStreamDestination();
    this.out.connect(this.recordDest);
    this.master = new Tone.Gain(1).connect(this.out); // sourdine générale (deux poings fermés)
    this.reverb = new Tone.Reverb({ decay: 4, wet: 0.18 }).connect(this.master);
    this.delay = new Tone.FeedbackDelay({ delayTime: '8n.', feedback: 0.35, wet: 0 }).connect(this.reverb);
    this.stutter = new Tone.Tremolo({ frequency: 8, type: 'square', depth: 0, spread: 0 }).connect(this.delay).start();
    this.crusher = new Tone.BitCrusher(4).connect(this.stutter);
    this.crusher.wet.value = 0;
    this.bus = new Tone.Gain(0.9).connect(this.crusher);

    // Accords
    this.chorus = new Tone.Chorus({ frequency: 1.5, delayTime: 3.5, depth: 0.5, wet: 0.35 }).connect(this.bus).start();
    this.grit = new Tone.Distortion({ distortion: 0.6, wet: 0 }).connect(this.chorus);
    this.tremolo = new Tone.Tremolo({ frequency: '8n', depth: 0, spread: 40 }).connect(this.grit).start();
    this.padFilter = new Tone.Filter({ type: 'lowpass', frequency: 2400, Q: 0.8 }).connect(this.tremolo);
    this.pad = makePad(this.bank).connect(this.padFilter);
    this.chordInst = this.pad; // instrument qui joue les accords (synthé ou échantillons)
    this.arpSynth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.005, decay: 0.15, sustain: 0.2, release: 0.3 },
      volume: -10,
    }).connect(this.padFilter);

    // Batterie
    this.drumFilter = new Tone.Filter({ type: 'lowpass', frequency: 18000 }).connect(this.bus);
    const drumBus = new Tone.Volume(-3).connect(this.drumFilter);
    this.drums = {
      kick: new Tone.MembraneSynth({ pitchDecay: 0.03, octaves: 6, envelope: { attack: 0.001, decay: 0.35, sustain: 0 } }).connect(drumBus),
      snare: new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.16, sustain: 0 }, volume: -8 }).connect(
        new Tone.Filter(1800, 'bandpass').connect(drumBus),
      ),
      hats: new Tone.MetalSynth({ envelope: { attack: 0.001, decay: 0.06, release: 0.01 }, harmonicity: 5.1, modulationIndex: 32, resonance: 7000, octaves: 1.5, volume: -24 }).connect(drumBus),
      toms: new Tone.MembraneSynth({ pitchDecay: 0.08, octaves: 2.5, envelope: { attack: 0.001, decay: 0.3, sustain: 0 }, volume: -6 }).connect(drumBus),
    };
    this.tomNotes = { 3: 'A2', 6: 'G2', 8: 'E2', 10: 'D2', 11: 'D2', 12: 'C2', 13: 'C2', 14: 'A1', 15: 'G1' };

    // Basse
    this.bassDuck = new Tone.Gain(1).connect(this.bus);
    this.bass = new Tone.MonoSynth({
      oscillator: { type: 'sawtooth' },
      filter: { type: 'lowpass', Q: 2, rolloff: -24 },
      filterEnvelope: { attack: 0.005, decay: 0.2, sustain: 0.3, release: 0.2, baseFrequency: 90, octaves: 3 },
      envelope: { attack: 0.005, decay: 0.2, sustain: 0.6, release: 0.15 },
      volume: -6,
    }).connect(this.bassDuck);

    // Voix mélodiques (une par doigt)
    this.leadFilter = new Tone.Filter({ type: 'lowpass', frequency: 5000, Q: 1 }).connect(this.bus);
    const lead = (type, extra = {}) =>
      new Tone.MonoSynth({
        oscillator: { type },
        portamento: 0.06,
        envelope: { attack: 0.02, decay: 0.1, sustain: 0.8, release: 0.4 },
        filterEnvelope: { attack: 0.01, decay: 0.2, sustain: 1, release: 0.4, baseFrequency: 3000, octaves: 0 },
        volume: -14,
        ...extra,
      }).connect(this.leadFilter);
    this.leads = [lead('sawtooth'), lead('square', { volume: -18 }), lead('sine', { volume: -8 }), lead('fmsine', { volume: -12 })];

    // Séquenceur à la double-croche.
    this.transport.bpm.value = bpm;
    this.transport.scheduleRepeat((time) => this.tick(time), '16n');
    this.arpLoop = new Tone.Loop((time) => this.arpTick(time), '16n');
    this.transport.start('+0.05');
    this.ready = true;
    try {
      await this.setInstrument(instrument);
    } catch (err) {
      console.warn('Échantillons indisponibles, retour au synthé', err);
      await this.setInstrument('synth');
    }
  }

  /** Charge (une seule fois) les deux échantillonneurs d'un instrument : accords et mélodie. */
  loadSamplers(id) {
    if (!this.samplers[id]) {
      const urls = sampleUrls(id);
      const { release } = instrumentInfo(id);
      const make = (dest, volume) =>
        new Promise((resolve, reject) => {
          const sampler = new Tone.Sampler({
            urls,
            baseUrl: `${SAMPLE_BASE}${id}/`,
            release,
            volume,
            onload: () => resolve(sampler),
            onerror: (e) => reject(e),
          }).connect(dest);
        });
      this.samplers[id] = Promise.all([make(this.padFilter, -6), make(this.leadFilter, -2)]).then(([chord, lead]) => ({ chord, lead }));
      this.samplers[id].catch(() => delete this.samplers[id]);
    }
    return this.samplers[id];
  }

  /** Change d'instrument ; l'accord tenu continue avec le nouveau son. */
  async setInstrument(id) {
    const info = instrumentInfo(id);
    const pair = info.id === 'synth' ? { chord: this.pad, lead: null } : await this.loadSamplers(info.id);
    const notes = this.chordNotes;
    if (this.ready) {
      this.chordInst.releaseAll();
      this.leadNotes.forEach((_, i) => this.leadOff(i));
    }
    this.chordInst = pair.chord;
    this.leadSampler = pair.lead;
    this.instrument = info.id;
    this.applyEnvelope();
    if (notes.length) {
      this.chordNotes = [];
      this.setChord(notes);
    }
    return info;
  }

  setMuted(on) {
    this.muted = on;
    if (this.ready) this.master.gain.rampTo(on ? 0 : 1, 0.06);
  }

  setBpm(bpm) {
    if (this.ready) this.transport.bpm.rampTo(bpm, 0.2);
    if (this.stutter) this.stutter.frequency.value = (bpm / 60) * 4;
  }

  /** Prochaine croche (pour caler les accords sur la grille). */
  nextEighth() {
    return this.transport.nextSubdivision('8n');
  }

  tick(time) {
    const step = this.step;
    for (let f = 0; f < 4; f++) {
      const family = DRUM_FAMILIES[f];
      const vel = drumBar(family, this.drumLevels[f], this.bar)[step];
      if (vel > 0) this.hitDrum(family, vel, time, step);
    }
    const note = bassStep(this.bassParams, step, this.bar, this.chord);
    if (note) this.bass.triggerAttackRelease(Tone.Frequency(note.midi, 'midi').toFrequency(), note.dur, time, note.vel);
    if (this.onStep) {
      const s = step;
      const b = this.bar;
      Tone.getDraw().schedule(() => this.onStep(s, b), time);
    }
    this.step = (step + 1) % 16;
    if (this.step === 0) this.bar++;
  }

  hitDrum(family, vel, time, step = 0) {
    const d = this.drums[family];
    if (family === 'kick') {
      d.triggerAttackRelease('C1', '8n', time, vel);
      // La basse s'efface un instant sous la grosse caisse.
      this.bassDuck.gain.cancelScheduledValues(time);
      this.bassDuck.gain.setValueAtTime(0.3, time);
      this.bassDuck.gain.linearRampToValueAtTime(1, time + 0.18);
    } else if (family === 'snare') d.triggerAttackRelease(0.15, time, vel);
    else if (family === 'hats') d.triggerAttackRelease('C6', 0.04, time, vel);
    else d.triggerAttackRelease(this.tomNotes[step] ?? 'D2', '8n', time, vel);
  }

  // --- Accords -------------------------------------------------------------------------------

  setBank(bank) {
    if (!BANKS[bank] || bank === this.bank) return;
    this.bank = bank;
    if (!this.ready) return;
    const active = this.chordInst === this.pad;
    const notes = this.chordNotes;
    if (active) this.releaseChord();
    this.pad.dispose();
    this.pad = makePad(bank).connect(this.padFilter);
    if (!active) return; // un instrument enregistré joue : la banque servira au retour sur « synthé »
    this.chordInst = this.pad;
    this.applyEnvelope();
    if (notes.length) this.setChord(notes);
  }

  /** Remplace l'accord tenu : seules les notes qui changent sont relâchées / attaquées. */
  setChord(notes, time = Tone.now()) {
    if (!this.ready) return;
    const old = new Set(this.chordNotes);
    const next = new Set(notes);
    const off = this.chordNotes.filter((n) => !next.has(n));
    const on = notes.filter((n) => !old.has(n));
    this.chordNotes = [...notes];
    if (this.arpRate) return; // l'arpège lit chordNotes à chaque pas
    const f = (m) => Tone.Frequency(m, 'midi').toFrequency();
    if (off.length) this.chordInst.triggerRelease(off.map(f), time);
    if (on.length) this.chordInst.triggerAttack(on.map(f), time, 0.55);
  }

  releaseChord(time = Tone.now()) {
    if (!this.ready) return;
    this.chordInst.releaseAll(time);
    this.chordNotes = [];
  }

  /** Rotation du poignet gauche : brillance du filtre et longueur des notes. */
  setPadTone(roll) {
    if (!this.ready) return;
    this.padFilter.frequency.rampTo(250 * 48 ** roll, 0.05);
    this.padRelease = 0.2 + roll * 3;
    this.applyEnvelope();
  }

  applyEnvelope() {
    if (!this.ready) return;
    const e = this.envelope;
    const attack = 0.005 + e * 1.2;
    const release = (this.padRelease ?? 1.5) + e * 2;
    if (this.chordInst instanceof Tone.Sampler) {
      this.chordInst.attack = attack;
      this.chordInst.release = release;
    } else {
      this.chordInst.set({ envelope: { attack, release } });
    }
  }

  // --- Sculpt ---------------------------------------------------------------------------------

  setArp(value) {
    const rate = ARP_RATES[Math.round(value * (ARP_RATES.length - 1))];
    if (rate === this.arpRate || !this.ready) return;
    const notes = this.chordNotes;
    if (rate && !this.arpRate) {
      this.chordInst.releaseAll();
      this.arpLoop.start(this.transport.nextSubdivision('16n'));
    } else if (!rate && this.arpRate) {
      this.arpLoop.stop();
      this.chordNotes = [];
      this.setChord(notes);
    }
    this.arpRate = rate;
    if (rate) this.arpLoop.interval = rate;
  }

  arpTick(time) {
    const notes = this.chordNotes.slice(1); // sans la basse
    if (!notes.length) return;
    const n = notes[this.arpIndex % notes.length];
    this.arpIndex++;
    this.arpSynth.triggerAttackRelease(Tone.Frequency(n + 12, 'midi').toFrequency(), this.arpRate, time, 0.6);
  }

  setEnvelope(value) {
    this.envelope = value;
    this.applyEnvelope();
  }

  setTremolo(value) {
    if (this.ready) this.tremolo.depth.rampTo(value, 0.05);
  }

  setGrit(value) {
    if (this.ready) this.grit.wet.rampTo(value * 0.8, 0.05);
  }

  // --- Batterie / basse -----------------------------------------------------------------------

  setDrumCutoff(value) {
    if (this.ready) this.drumFilter.frequency.rampTo(300 * 60 ** value, 0.05);
  }

  setBassResonance(value) {
    if (this.ready) this.bass.filter.Q.rampTo(1 + value * 14, 0.05);
  }

  // --- Mélodie --------------------------------------------------------------------------------

  leadOn(voice, midi) {
    if (!this.ready) return;
    const f = Tone.Frequency(midi, 'midi').toFrequency();
    if (this.leadSampler) {
      // Instrument enregistré : chaque changement de couloir rejoue la note.
      const old = this.leadNotes[voice];
      if (old === midi) return;
      if (old !== null) this.leadSampler.triggerRelease(Tone.Frequency(old, 'midi').toFrequency());
      this.leadSampler.triggerAttack(f, Tone.now(), 0.8);
      this.leadNotes[voice] = midi;
      return;
    }
    if (this.leadNotes[voice] === null) this.leads[voice].triggerAttack(f);
    else if (this.leadNotes[voice] !== midi) this.leads[voice].setNote(f);
    this.leadNotes[voice] = midi;
  }

  leadOff(voice) {
    if (!this.ready || this.leadNotes[voice] === null) return;
    if (this.leadSampler) this.leadSampler.triggerRelease(Tone.Frequency(this.leadNotes[voice], 'midi').toFrequency());
    else this.leads[voice].triggerRelease();
    this.leadNotes[voice] = null;
  }

  setLeadFilter(value) {
    if (this.ready) this.leadFilter.frequency.rampTo(300 * 50 ** value, 0.05);
  }

  // --- Effets momentanés ----------------------------------------------------------------------

  /** fx : 0 delay, 1 réverbération, 2 stutter, 3 bitcrush ; amount 0..1 (0 = coupé). */
  setFx(index, amount, active) {
    if (!this.ready) return;
    const a = active ? amount : 0;
    if (index === 0) {
      this.delay.wet.rampTo(active ? 0.5 : 0, 0.05);
      this.delay.feedback.rampTo(0.2 + a * 0.6, 0.05);
    } else if (index === 1) {
      this.reverb.wet.rampTo(active ? 0.4 + a * 0.55 : 0.18, 0.1);
    } else if (index === 2) {
      this.stutter.depth.rampTo(active ? 1 : 0, 0.02);
      const div = [2, 4, 8, 16][Math.min(3, Math.floor(a * 4))];
      this.stutter.frequency.value = (this.transport.bpm.value / 60) * div;
    } else if (index === 3) {
      this.crusher.wet.rampTo(active ? 1 : 0, 0.02);
      this.crusher.bits.value = Math.round(8 - a * 6);
    }
  }

  stopAll() {
    if (!this.ready) return;
    this.releaseChord();
    this.leadNotes.forEach((_, i) => this.leadOff(i));
    this.drumLevels = [0, 0, 0, 0];
    this.bassParams = { density: 0, tones: 0, octave: 0, feel: 0 };
    for (let i = 0; i < 4; i++) this.setFx(i, 0, false);
  }

  get recordStream() {
    return this.recordDest?.stream ?? null;
  }
}
