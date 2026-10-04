// Geste Live : main gauche = accords, main droite = arc de 5 modes (batterie, basse, mélodie, fx, sculpt).

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

const $ = (id) => document.getElementById(id);
const STORE = 'geste-live.settings.v1';

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
  scrim: 0.5,
  format: 'wide',
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
    this.mode = null;
    this.frame = null;
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
    $('set-bpm').value = this.s.bpm;
    $('bpm-out').textContent = this.s.bpm;
    $('set-scrim').value = this.s.scrim;
    for (const k of ['snap', 'mirror', 'swap', 'invertPalm', 'simpleArc']) $(`set-${k}`).checked = this.s[k];

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
    for (const k of ['snap', 'mirror', 'swap', 'invertPalm', 'simpleArc']) bind(`set-${k}`, k);

    $('start').addEventListener('click', () => this.start());
    $('btn-rec').addEventListener('click', () => this.toggleRecord());
    $('btn-settings').addEventListener('click', () => this.togglePanel('settings'));
    $('btn-help').addEventListener('click', () => this.togglePanel('help'));
    $('intro-help').addEventListener('click', () => this.togglePanel('help'));
    document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => this.togglePanel(null)));

    window.addEventListener('resize', () => this.resize());
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.key >= '1' && e.key <= '5') this.setMode(ARC_MODES[+e.key - 1]);
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
    for (const p of ['settings', 'help']) {
      const el = $(`panel-${p}`);
      el.hidden = !(name === p && el.hidden);
    }
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(window.innerWidth * dpr);
    this.canvas.height = Math.round(window.innerHeight * dpr);
    this.dpr = dpr;
  }

  // --- Démarrage ------------------------------------------------------------------------------

  async start() {
    if (this.started) return;
    const btn = $('start');
    btn.disabled = true;
    btn.textContent = 'chargement de l\'instrument…';
    try {
      await this.audio.start(this.s.bpm);
      this.audio.onStep = (s, b) => {
        this.step = s;
        this.bar = b;
      };
      this.applySettings();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user', frameRate: { ideal: 30 } },
        audio: false,
      });
      this.video.srcObject = stream;
      await this.video.play();
      await this.detector.init({ numHands: 2 });
      this.started = true;
      $('intro').hidden = true;
      $('rail').hidden = false;
      this.plate.say('montrez une main · comptez un doigt');
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

    // Main gauche : accords.
    this.chordState = this.chordHand.update(L, this.key, L ? this.norm(L.height) : 0, t);
    this.audio.chord = this.chordHand.chord;

    // Main droite : arc puis mode.
    const ev = this.arc.update(R, t);
    if (ev.type === 'opened') {
      if (this.mode && this.pinch.finger !== null) this.modes[this.mode].release(this.pinch.finger);
      this.pinch.reset();
    } else if (ev.type === 'selected') this.setMode(ev.mode);
    else if (ev.type === 'cancelled') this.plate.say('annulé');

    if (!this.arc.open && this.mode) {
      const mode = this.modes[this.mode];
      const p = this.pinch.update(R);
      if (p.ended !== null) mode.release(p.ended);
      if (R) {
        const h = this.norm(R.height);
        if (p.finger !== null) mode.hold(p.finger, R, h);
        else mode.idle(R, h);
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
    };
  }

  render() {
    const S = this.state();
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.plate.render(this.ctx, this.canvas.width / this.dpr, this.canvas.height / this.dpr, S);
    if (this.vertical) this.plate.render(this.vertical.ctx, 720, 1280, S);
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
