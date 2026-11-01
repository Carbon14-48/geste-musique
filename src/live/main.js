// Geste Live : main gauche = accords et roue d'instruments, main droite = arc de 5 modes
// (batterie, basse, mélodie, fx, sculpt). Poses reconnues par les règles ou par un modèle TensorFlow.js.

import './live.css';
import { HandDetector } from '../core/detector.js';
import { HandTracker } from '../core/handTracker.js';
import { LiveAudio, BANKS } from './audio.js';
import { ChordHand } from './chordHand.js';
import { ArcSelector, ARC_MODES, ARC_NAMES } from './arc.js';
import { PinchTracker } from './pinch.js';
import { createModes } from './rightModes.js';
import { Plate } from './plate.js';
import { TakeRecorder } from './recorder.js';
import { NOTES_FR, keyName } from './theory.js';
import { INSTRUMENTS, SAMPLE_CREDIT, cycleInstrument, instrumentInfo } from './instruments.js';
import { Tutorial } from './tutorial.js';
import { InstrumentWheel } from './wheel.js';
import { MuteDetector } from './mute.js';
import { TRAINABLE_POSES, hasSavedModel, hasPythonModel } from '../ml/poses.js';

const $ = (id) => document.getElementById(id);
const STORE = 'geste-live.settings.v2'; // v2 : rôles des mains corrigés, nouveaux réglages d'image

const DEFAULTS = {
  root: 9,
  mode: 'minor',
  bpm: 100,
  bank: 'pad',
  snap: true,
  mirror: true,
  swap: false,
  invertPalm: false,
  simpleArc: false,
  scrim: 0.25,
  enhance: true,
  format: 'wide',
  instrument: 'piano',
  tutor: true, // tutoriel ouvert au premier lancement
};

function loadSettings() {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(STORE)) ?? {}) };
  } catch {
    return { ...DEFAULTS };
  }
}

class GesteLive {
  constructor() {
    this.s = loadSettings();
    this.canvas = $('plate');
    this.ctx = this.canvas.getContext('2d');
    this.video = $('cam');
    this.detector = new HandDetector();
    this.tracker = new HandTracker();
    this.audio = new LiveAudio();
    this.chordHand = new ChordHand(this.audio);
    this.arc = new ArcSelector();
    this.pinch = new PinchTracker();
    this.modes = createModes(this.audio, this.chordHand);
    this.plate = new Plate();
    this.recorder = new TakeRecorder();
    this.mode = 'melody'; // la main droite joue la mélodie dès le départ
    this.frame = null;
    this.mute = new MuteDetector();
    this.muted = false;
    this.mutedSince = 0;
    this.panicked = false;
    this.wheel = new InstrumentWheel({ count: INSTRUMENTS.length });
    this.chordPauseUntil = 0; // pas d'accord juste après avoir validé la roue (main ouverte = V)
    this.learnSamples = []; // {label, x} enregistrés pour l'entraînement TensorFlow
    this.learning = null; // {label, until}
    this.modelSource = 'standard';
    this.loadingInstrument = null;
    // Compteurs utilisés par le tutoriel pour savoir si un geste a été réussi.
    this.stats = {
      chordsPlayed: 0,
      chordNames: new Set(),
      richChords: 0,
      instrumentChanges: 0,
      melodyNotes: 0,
      arcSelections: 0,
      drumChanges: 0,
      mutes: 0,
    };
    this.chordState = null;
    this.step = 0;
    this.bar = 0;
    this.started = false;
    this.vertical = null;
    this.applySettings();
  }

  get key() {
    return { root: this.s.root, mode: this.s.mode };
  }

  save() {
    try {
      localStorage.setItem(STORE, JSON.stringify(this.s));
    } catch {
      // réglages valables pour cette session seulement
    }
  }

  applySettings() {
    // Filtre CSS : appliqué par la carte graphique, presque gratuit (ctx.filter, lui, ralentissait tout).
    this.canvas.style.filter = this.s.enhance ? 'brightness(1.08) contrast(1.1) saturate(1.08)' : '';
    this.tracker.mirror = this.s.mirror;
    this.tracker.swapHands = this.s.swap;
    this.tracker.invertPalm = this.s.invertPalm;
    this.chordHand.snap = this.s.snap;
    this.arc.requireBack = !this.s.simpleArc;
    this.modes.melody.key = this.key;
    this.audio.setBpm(this.s.bpm);
    this.audio.setBank(this.s.bank);
  }

  /** Hauteur de la main (0 = bas de l'image, 1 = haut), étirée sur la zone confortable. */
  norm(h) {
    return Math.max(0, Math.min(1, (h - 0.15) / 0.7));
  }

  // --- Interface DOM --------------------------------------------------------------------------

  initUI() {
    const fill = (sel, entries, value) => {
      sel.innerHTML = '';
      for (const [v, l] of entries) sel.append(new Option(l, v));
      sel.value = String(value);
    };
    fill($('set-root'), NOTES_FR.map((n, i) => [i, n]), this.s.root);
    fill($('set-mode'), [['major', 'majeur'], ['minor', 'mineur']], this.s.mode);
    fill($('set-bank'), Object.entries(BANKS), this.s.bank);
    fill($('rec-format'), [['wide', 'large'], ['vertical', 'vertical 720×1280'], ['both', 'les deux']], this.s.format);
    fill($('instrument'), INSTRUMENTS.map((i) => [i.id, i.name]), this.s.instrument);
    $('instrument').addEventListener('change', (e) => this.changeInstrument(e.target.value));
    $('credit').textContent = SAMPLE_CREDIT;
    $('set-bpm').value = this.s.bpm;
    $('bpm-out').textContent = this.s.bpm;
    $('set-scrim').value = this.s.scrim;
    for (const k of ['snap', 'mirror', 'swap', 'invertPalm', 'simpleArc', 'enhance']) $(`set-${k}`).checked = this.s[k];

    const bind = (id, key, parse = (v) => v) => {
      $(id).addEventListener('input', (e) => {
        const el = e.target;
        this.s[key] = el.type === 'checkbox' ? el.checked : parse(el.value);
        if (key === 'bpm') $('bpm-out').textContent = this.s.bpm;
        this.applySettings();
        this.save();
      });
    };
    bind('set-root', 'root', Number);
    bind('set-mode', 'mode');
    bind('set-bpm', 'bpm', Number);
    bind('set-bank', 'bank');
    bind('set-scrim', 'scrim', Number);
    bind('rec-format', 'format');
    for (const k of ['snap', 'mirror', 'swap', 'invertPalm', 'simpleArc', 'enhance']) bind(`set-${k}`, k);

    $('start').addEventListener('click', () => this.start());
    $('btn-rec').addEventListener('click', () => this.toggleRecord());
    $('btn-settings').addEventListener('click', () => this.togglePanel('settings'));
    $('btn-help').addEventListener('click', () => this.togglePanel('help'));
    $('btn-learn').addEventListener('click', () => this.togglePanel('learn'));
    this.initLearn();
    $('intro-help').addEventListener('click', () => this.toggleTutor(true));
    $('btn-tutor').addEventListener('click', () => this.toggleTutor());
    $('tutor-close').addEventListener('click', () => this.toggleTutor(false));
    this.tutorial = new Tutorial(this, {
      panel: $('tutor'),
      canvas: $('tutor-canvas'),
      step: $('tutor-step'),
      title: $('tutor-title'),
      text: $('tutor-text'),
      status: $('tutor-status'),
      prev: $('tutor-prev'),
      next: $('tutor-next'),
    });
    this.toggleTutor(this.s.tutor);
    document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => this.togglePanel(null)));

    window.addEventListener('resize', () => this.resize());
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.key >= '1' && e.key <= '5') this.setMode(ARC_MODES[+e.key - 1]);
      else if (e.key === 'ArrowRight') this.changeInstrument(cycleInstrument(this.s.instrument, 1));
      else if (e.key === 'ArrowLeft') this.changeInstrument(cycleInstrument(this.s.instrument, -1));
      else if (e.key === 'h' || e.key === 'H') this.toggleTutor();
      else if (e.key === '0') this.setMode(null);
      else if (e.key === 'r' || e.key === 'R') this.toggleRecord();
      else if (e.key === ' ') {
        e.preventDefault();
        this.panic();
      } else if (e.key === 'Escape') this.togglePanel(null);
    });
    this.resize();
    this.render();
  }

  /** Ouvre le panneau demandé (ou le referme s'il était déjà ouvert) ; null ferme tout. */
  togglePanel(name) {
    for (const p of ['settings', 'help', 'learn']) {
      const el = $(`panel-${p}`);
      el.hidden = !(name === p && el.hidden);
    }
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(this.canvas.clientWidth * dpr);
    this.canvas.height = Math.round(this.canvas.clientHeight * dpr);
    this.dpr = dpr;
  }

  /** Ouvre / ferme le tutoriel animé à droite (la planche se rétrécit pour lui faire de la place). */
  toggleTutor(force) {
    const open = force ?? $('tutor').hidden;
    $('tutor').hidden = !open;
    document.body.classList.toggle('with-tutor', open);
    $('btn-tutor').classList.toggle('on', open);
    this.s.tutor = open;
    this.save();
    this.resize();
  }

  async changeInstrument(id) {
    const info = instrumentInfo(id);
    this.s.instrument = info.id;
    this.save();
    $('instrument').value = info.id;
    if (!this.audio.ready) return;
    this.loadingInstrument = info.id;
    this.plate.say(`chargement : ${info.name}…`);
    try {
      await this.audio.setInstrument(info.id);
      if (this.loadingInstrument !== info.id) return; // un autre choix est arrivé entre-temps
      this.plate.say(`instrument : ${info.name}`);
      this.stats.instrumentChanges++;
    } catch {
      this.plate.say(`${info.name} : échantillons indisponibles (connexion ?)`);
    }
  }

  // --- Démarrage ------------------------------------------------------------------------------

  async start() {
    if (this.started) return;
    const btn = $('start');
    btn.disabled = true;
    btn.textContent = 'chargement de l\'instrument…';
    try {
      await this.audio.start(this.s.bpm, this.s.instrument);
      this.audio.onStep = (s, b) => {
        this.step = s;
        this.bar = b;
      };
      this.applySettings();
      this.video.srcObject = await this.openCamera();
      await this.video.play();
      await this.detector.init({ numHands: 2 });
      await this.loadPoseModel();
      this.started = true;
      $('intro').hidden = true;
      $('rail').hidden = false;
      if (this.audio.instrument !== this.s.instrument) {
        this.plate.say(`${instrumentInfo(this.s.instrument).name} indisponible (connexion ?) · synthé à la place`);
      } else {
        this.plate.say(`instrument : ${instrumentInfo(this.audio.instrument).name} · montrez vos mains`);
      }
      this.loopDetect();
    } catch (err) {
      console.error(err);
      btn.disabled = false;
      btn.textContent = 'réessayer';
      const msg =
        err?.name === 'NotAllowedError'
          ? 'La caméra est bloquée : autorisez-la avec l\'icône de caméra dans la barre d\'adresse, puis réessayez.'
          : `Impossible de démarrer : ${err?.message ?? err}`;
      $('intro-error').textContent = msg;
    }
  }

  /** Caméra en 720p (480p sinon), avec exposition et balance des blancs automatiques. */
  async openCamera() {
    const ask = (w, h) =>
      navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: w }, height: { ideal: h }, facingMode: 'user', frameRate: { ideal: 30 } },
        audio: false,
      });
    let stream;
    try {
      // 720p : au-delà, MediaPipe ralentit beaucoup pour un gain de détection nul.
      stream = await ask(1280, 720);
    } catch (err) {
      if (err?.name === 'NotAllowedError') throw err;
      stream = await ask(640, 480);
    }
    const track = stream.getVideoTracks()[0];
    const caps = track.getCapabilities?.() ?? {};
    const advanced = {};
    if (caps.exposureMode?.includes('continuous')) advanced.exposureMode = 'continuous';
    if (caps.whiteBalanceMode?.includes('continuous')) advanced.whiteBalanceMode = 'continuous';
    if (caps.focusMode?.includes('continuous')) advanced.focusMode = 'continuous';
    if (Object.keys(advanced).length) await track.applyConstraints({ advanced: [advanced] }).catch(() => {});
    return stream;
  }

  // --- TensorFlow ------------------------------------------------------------------------------

  /** Modèle personnel (entraîné dans la page) en priorité, sinon le modèle Python, sinon les règles. */
  async loadPoseModel() {
    // TensorFlow.js (1,3 Mo) n'est chargé que s'il y a un modèle à utiliser.
    if (hasSavedModel()) {
      const { BrowserPoseModel } = await import('../ml/trainer.js');
      const own = await BrowserPoseModel.load();
      if (own) return this.useModel(own, 'gestes personnalisés');
    }
    try {
      if (!(await hasPythonModel())) return this.useModel(null, 'standard');
      const [{ PoseModel }, { useCpu }] = await Promise.all([import('../ml/models.js'), import('../ml/trainer.js')]);
      await useCpu();
      const python = await PoseModel.load();
      if (python) return this.useModel(python, 'avancée');
    } catch (err) {
      console.warn('modèle de poses illisible', err);
    }
    this.useModel(null, 'standard');
  }

  useModel(model, source) {
    this.tracker.poseModel = model;
    this.modelSource = source;
    $('learn-source').textContent = source;
  }

  initLearn() {
    const box = $('learn-poses');
    this.learnButtons = {};
    for (const { label, name } of TRAINABLE_POSES) {
      const b = document.createElement('button');
      b.innerHTML = `${name} <span class="n">0</span>`;
      b.addEventListener('click', () => this.recordPose(label));
      box.append(b);
      this.learnButtons[label] = b;
    }
    $('learn-train').addEventListener('click', () => this.trainModel());
    $('learn-reset').addEventListener('click', async () => {
      this.learnSamples = [];
      this.updateLearnCounts();
      const { BrowserPoseModel } = await import('../ml/trainer.js');
      await BrowserPoseModel.remove();
      await this.loadPoseModel();
      $('learn-status').textContent = 'gestes personnalisés effacés';
    });
  }

  updateLearnCounts() {
    for (const [label, b] of Object.entries(this.learnButtons)) {
      b.querySelector('.n').textContent = this.learnSamples.filter((s) => s.label === label).length;
      b.classList.toggle('recording', this.learning?.label === label);
    }
  }

  recordPose(label) {
    if (!this.started) {
      $('learn-status').textContent = 'commencez d\'abord (bouton « commencer »)';
      return;
    }
    // Une seconde pour se mettre en place, puis 3 secondes d'enregistrement.
    this.learning = { label, from: performance.now() + 1000, until: performance.now() + 4000 };
    $('learn-status').textContent = 'préparez la pose…';
    this.updateLearnCounts();
  }

  /** Appelé à chaque image : ajoute les mains visibles à la pose en cours d'enregistrement. */
  collectSample(frame, t) {
    const L = this.learning;
    if (!L || t < L.from) return;
    if (t > L.until) {
      this.learning = null;
      $('learn-status').textContent = 'pose enregistrée';
      this.updateLearnCounts();
      return;
    }
    for (const hand of [frame.hands.left, frame.hands.right]) {
      if (hand) this.learnSamples.push({ label: L.label, x: Array.from(hand.features) });
    }
    $('learn-status').textContent = `enregistrement… ${((L.until - t) / 1000).toFixed(1)} s`;
    if (Math.round(t / 100) % 3 === 0) this.updateLearnCounts();
  }

  async trainModel() {
    const status = $('learn-status');
    const bar = $('learn-progress');
    const n = new Set(this.learnSamples.map((s) => s.label)).size;
    if (n < 2) {
      status.textContent = 'montre au moins deux gestes différents (idéalement tous)';
      return;
    }
    bar.hidden = false;
    status.textContent = 'je m\'adapte à tes gestes…';
    try {
      const { BrowserPoseModel } = await import('../ml/trainer.js');
      const model = await BrowserPoseModel.train(this.learnSamples, {
        onProgress: (epoch, epochs) => {
          bar.value = epoch / epochs;
          status.textContent = `je m'adapte à tes gestes… ${Math.round((epoch / epochs) * 100)} %`;
        },
      });
      await model.save().catch(() => {}); // sans IndexedDB : modèle gardé pour cette session
      this.useModel(model, 'gestes personnalisés');
      status.textContent = 'c\'est prêt ! tes gestes sont maintenant reconnus.';
      this.plate.say('mes gestes activés');
    } catch {
      status.textContent = 'ça n\'a pas marché, réessaie.';
    } finally {
      bar.hidden = true;
    }
  }

  loopDetect() {
    let last = -1;
    const step = () => {
      if (this.video.currentTime !== last && this.video.readyState >= 2) {
        last = this.video.currentTime;
        this.process(performance.now());
      }
      if (this.video.requestVideoFrameCallback) this.video.requestVideoFrameCallback(step);
      else requestAnimationFrame(step);
    };
    step();
  }

  setMode(mode) {
    if (this.mode && this.pinch.finger !== null) this.modes[this.mode].release(this.pinch.finger);
    this.pinch.reset();
    this.mode = mode;
    this.plate.say(mode ? `mode : ${ARC_NAMES[mode]}` : 'aucun mode');
  }

  panic() {
    this.audio.stopAll();
    const m = this.modes;
    m.drums.levels = [0, 0, 0, 0];
    m.bass.values = [0, 0, 0, 0];
    m.sculpt.values = [0, 0, 0, 0];
    this.audio.setArp(0);
    this.audio.setEnvelope(0);
    this.audio.setTremolo(0);
    this.audio.setGrit(0);
    this.plate.say('silence');
  }

  process(t) {
    const result = this.detector.detect(this.video, t);
    const frame = this.tracker.update(result, t);
    this.frame = frame;
    const L = frame.hands.left;
    const R = frame.hands.right;
    this.collectSample(frame, t);

    // Main gauche : roue d'instruments (poing tenu, rotation du poignet, main ouverte pour valider).
    const current = INSTRUMENTS.findIndex((i) => i.id === this.s.instrument);
    const wev = this.wheel.update(L, Math.max(0, current), t, R?.label === 'fist');
    if (wev.type === 'opened') this.plate.say('roue : tournez le poignet, ouvrez la main');
    else if (wev.type === 'selected') {
      this.chordPauseUntil = t + 700;
      if (wev.index !== current) this.changeInstrument(INSTRUMENTS[wev.index].id);
      else this.plate.say(`instrument : ${INSTRUMENTS[wev.index].name}`);
    }

    // Main gauche : accords (en pause pendant la roue).
    const chordHand = this.wheel.open || t < this.chordPauseUntil ? null : L;
    const prev = this.chordState;
    this.chordState = this.chordHand.update(chordHand, this.key, L ? this.norm(L.height) : 0, t);
    this.audio.chord = this.chordHand.chord;
    const cs = this.chordState;
    if (cs && (!prev || prev.name !== cs.name)) {
      this.stats.chordsPlayed++;
      this.stats.chordNames.add(cs.name);
      if (cs.spice >= 2) this.stats.richChords++;
    }

    // Deux poings bien serrés : silence (plus d'une seconde et demie : tout s'arrête).
    // Détecteur strict : une main à moitié fermée ne suffit pas.
    const mute = this.mute.update(L, R);
    if (mute.muted) {
      if (mute.changed) {
        this.muted = true;
        this.mutedSince = t;
        this.panicked = false;
        this.stats.mutes++;
        this.audio.setMuted(true);
        this.arc.reset();
        this.wheel.reset();
        this.wheel.armed = false;
        if (this.mode && this.pinch.finger !== null) this.modes[this.mode].release(this.pinch.finger);
        this.pinch.reset();
      } else if (!this.panicked && t - this.mutedSince > 1500) {
        this.panicked = true;
        this.panic();
      }
      return;
    }
    if (this.muted) {
      this.muted = false;
      this.audio.setMuted(false);
    }

    // Main droite : arc puis mode.
    const ev = this.arc.update(R, t);
    if (ev.type === 'opened') {
      if (this.mode && this.pinch.finger !== null) this.modes[this.mode].release(this.pinch.finger);
      this.pinch.reset();
    } else if (ev.type === 'selected') {
      this.setMode(ev.mode);
      this.stats.arcSelections++;
    }
    else if (ev.type === 'cancelled') this.plate.say('annulé');

    if (!this.arc.open && this.mode) {
      const mode = this.modes[this.mode];
      const p = this.pinch.update(R);
      if (p.ended !== null) mode.release(p.ended);
      if (R) {
        const h = this.norm(R.height);
        if (p.finger !== null) {
          const lead = this.audio.leadNotes[p.finger];
          const drums = this.modes.drums.levels.join();
          mode.hold(p.finger, R, h);
          if (this.audio.leadNotes[p.finger] !== lead) this.stats.melodyNotes++;
          if (this.modes.drums.levels.join() !== drums) this.stats.drumChanges++;
        } else mode.idle(R, h);
      }
    }
  }

  // --- Rendu ----------------------------------------------------------------------------------

  state() {
    const f = this.frame;
    const L = f?.hands.left ?? null;
    const R = f?.hands.right ?? null;
    return {
      video: this.video,
      mirror: this.s.mirror,
      scrim: this.s.scrim,
      enhance: this.s.enhance,
      wheel: { open: this.wheel.open, hover: this.wheel.hover, anchor: this.wheel.anchor, items: INSTRUMENTS },
      modelSource: this.modelSource,
      started: this.started,
      hands: { left: L, right: R },
      chord: this.chordState,
      keyName: keyName(this.key),
      bpm: this.s.bpm,
      recording: this.recorder.active,
      recordingTime: this.recorder.elapsed(),
      mode: this.mode,
      modeState: this.mode ? this.modes[this.mode] : null,
      pinchFinger: this.arc.open ? null : this.pinch.finger,
      arc: { open: this.arc.open, hover: this.arc.hover, anchor: this.arc.anchor },
      step: this.step,
      bar: this.bar,
      leftHeight: L ? this.norm(L.height) : null,
      rightHeight: R ? this.norm(R.height) : null,
      leftRoll: L ? L.roll : null,
      rightRoll: R ? R.roll : null,
      instrument: instrumentInfo(this.audio.instrument).name,
      muted: this.muted,
    };
  }

  render() {
    const S = this.state();
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.plate.render(this.ctx, this.canvas.width / this.dpr, this.canvas.height / this.dpr, S);
    if (this.vertical) this.plate.render(this.vertical.ctx, 720, 1280, S);
    this.tutorial?.tick(performance.now());
    requestAnimationFrame(() => this.render());
  }

  async toggleRecord() {
    if (!this.started) return;
    const btn = $('btn-rec');
    if (!this.recorder.active) {
      const targets = [];
      if (this.s.format !== 'vertical') targets.push({ canvas: this.canvas, name: 'large' });
      if (this.s.format !== 'wide') {
        const c = document.createElement('canvas');
        c.width = 720;
        c.height = 1280;
        this.vertical = { canvas: c, ctx: c.getContext('2d') };
        targets.push({ canvas: c, name: 'vertical' });
      }
      this.recorder.start(targets, this.audio.recordStream);
      btn.classList.add('on');
      btn.textContent = '■ arrêter';
      this.plate.say('enregistrement');
    } else {
      const takes = await this.recorder.stop();
      this.vertical = null;
      btn.classList.remove('on');
      btn.textContent = '● enregistrer';
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      for (const take of takes) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(take.blob);
        a.download = `geste-live-${take.name}-${stamp}.${take.ext}`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      }
      this.plate.say('prise téléchargée');
    }
  }
}

const app = new GesteLive();
app.initUI();
window.gesteLive = app;
