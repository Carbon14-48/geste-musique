// Point d'entrée : caméra -> détection -> lissage -> reconnaissance -> déclencheurs -> mode -> son.

import { HandDetector } from './core/detector.js';
import { HandTracker } from './core/handTracker.js';
import { DEFAULT_THRESHOLDS, POSE_LABELS, POSE_NAMES } from './core/rules.js';
import { LM, dist } from './core/landmarks.js';
import { Cooldown } from './core/trigger.js';
import { NOTE_NAMES_FR, SCALES } from './core/scale.js';
import { AudioEngine, INSTRUMENTS } from './audio/engine.js';
import { MidiOut } from './audio/midi.js';
import { Looper } from './audio/looper.js';
import { MidiCapture } from './audio/midiCapture.js';
import { KnnClassifier } from './ml/knn.js';
import { PoseModel, DynamicModel } from './ml/models.js';
import { DatasetRecorder } from './ml/dataset.js';
import { MODES, findMode } from './modes/index.js';
import { GlobalGestures, GLOBAL_HELP } from './modes/global.js';
import { Overlay } from './ui/overlay.js';

const $ = (id) => document.getElementById(id);
const SETTINGS_KEY = 'geste-musique.settings.v1';
const CALIB_KEY = 'geste-musique.calibration.v1';
const SEQUENCE_LABELS = ['swipe_left', 'swipe_right', 'swipe_up', 'swipe_down', 'circle', 'shake', 'strike', 'wave', 'none'];

function loadJSON(key, fallback) {
  try {
    return { ...fallback, ...(JSON.parse(localStorage.getItem(key)) ?? {}) };
  } catch {
    return { ...fallback };
  }
}

function saveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // stockage indisponible : réglages valables pour cette session seulement
  }
}

function download(data, filename, type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
const mean = (arr) => arr.reduce((a, b) => a + b, 0) / Math.max(arr.length, 1);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class App {
  constructor() {
    this.settings = loadJSON(SETTINGS_KEY, {
      mode: 'notes',
      root: 60,
      scale: 'pentatonique',
      snap: true,
      mirror: true,
      swap: false,
      skeleton: true,
      instrument: 'piano',
    });
    this.calibration = loadJSON(CALIB_KEY, {
      thresholds: { ...DEFAULT_THRESHOLDS },
      heightMin: 0.1,
      heightMax: 0.9,
      open: null,
      fist: null,
    });

    this.midi = new MidiOut();
    this.engine = new AudioEngine(this.midi);
    this.engine.instrument = this.settings.instrument;
    this.looper = new Looper(this.engine);
    this.midiCapture = new MidiCapture(this.engine);
    this.detector = new HandDetector();
    this.tracker = new HandTracker();
    this.tracker.thresholds = { ...DEFAULT_THRESHOLDS, ...this.calibration.thresholds };
    this.tracker.mirror = this.settings.mirror;
    this.tracker.swapHands = this.settings.swap;
    this.knn = new KnnClassifier();
    this.knn.restore();
    this.dataset = new DatasetRecorder();
    this.dynamicModel = null;
    this.dynamicCd = { left: new Cooldown(800), right: new Cooldown(800) };
    this.global = new GlobalGestures(this);
    this.overlay = new Overlay($('overlay'));
    this.overlay.showSkeleton = this.settings.skeleton;
    this.mode = findMode(this.settings.mode);
    this.locked = false;
    this.running = false;
    this.frame = null;
    this.frameCount = 0;
    this.capture = null; // capture en cours (calibration, apprentissage, données)
    this.perf = { detectMs: [], frames: [], lastUi: 0 };
    this.hudValues = {};
  }

  // --- API utilisée par les modes ---------------------------------------------------------

  notify(message) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = message;
    $('toasts').append(el);
    setTimeout(() => el.remove(), 2500);
    this.log(message);
  }

  log(message) {
    const li = document.createElement('li');
    li.textContent = `${new Date().toLocaleTimeString()}  ${message}`;
    const log = $('log');
    log.prepend(li);
    while (log.children.length > 40) log.lastChild.remove();
  }

  hud(key, value) {
    this.hudValues[key] = value;
  }

  normHeight(h) {
    const { heightMin, heightMax } = this.calibration;
    return Math.max(0, Math.min(1, (h - heightMin) / Math.max(heightMax - heightMin, 0.05)));
  }

  refreshControls() {
    $('instrument').value = this.engine.instrument;
    this.settings.instrument = this.engine.instrument;
    this.saveSettings();
  }

  saveSettings() {
    saveJSON(SETTINGS_KEY, this.settings);
  }

  // --- Initialisation -----------------------------------------------------------------------

  initUI() {
    const fill = (select, entries) => {
      select.innerHTML = '';
      for (const [value, label] of entries) select.append(new Option(label, value));
    };
    fill($('mode'), MODES.map((m, i) => [m.id, `${i + 1}. ${m.name}`]));
    fill($('instrument'), Object.entries(INSTRUMENTS));
    fill($('scale'), Object.entries(SCALES).map(([k, s]) => [k, s.name]));
    fill($('root'), Array.from({ length: 25 }, (_, i) => 48 + i).map((m) => [m, `${NOTE_NAMES_FR[m % 12]}${Math.floor(m / 12) - 1}`]));
    fill($('data-pose-label'), POSE_LABELS.filter((l) => l !== 'other').map((l) => [l, `${l} — ${POSE_NAMES[l]}`]));
    fill($('data-seq-label'), SEQUENCE_LABELS.map((l) => [l, l]));

    $('mode').value = this.mode.id;
    $('instrument').value = this.engine.instrument;
    $('scale').value = this.settings.scale;
    $('root').value = this.settings.root;
    $('snap').checked = this.settings.snap;
    $('mirror').checked = this.settings.mirror;
    $('swap').checked = this.settings.swap;
    $('skeleton').checked = this.settings.skeleton;
    $('video').classList.toggle('mirrored', this.settings.mirror);
    $('global-help').innerHTML = GLOBAL_HELP.map(([g, a]) => `<tr><td>${g}</td><td>${a}</td></tr>`).join('');
    this.renderModeHelp();
    this.renderThresholds();
    this.renderKnn();
    this.renderDataStats();

    $('start').addEventListener('click', () => this.start());
    $('mode').addEventListener('change', (e) => this.setMode(e.target.value));
    $('instrument').addEventListener('change', (e) => {
      this.engine.setInstrument(e.target.value);
      this.refreshControls();
    });
    $('scale').addEventListener('change', (e) => {
      this.settings.scale = e.target.value;
      this.saveSettings();
    });
    $('root').addEventListener('change', (e) => {
      this.settings.root = +e.target.value;
      this.saveSettings();
    });
    $('snap').addEventListener('change', (e) => {
      this.settings.snap = e.target.checked;
      this.saveSettings();
    });
    $('mirror').addEventListener('change', (e) => {
      this.settings.mirror = e.target.checked;
      this.tracker.mirror = e.target.checked;
      $('video').classList.toggle('mirrored', e.target.checked);
      this.saveSettings();
    });
    $('swap').addEventListener('change', (e) => {
      this.settings.swap = e.target.checked;
      this.tracker.swapHands = e.target.checked;
      this.saveSettings();
    });
    $('skeleton').addEventListener('change', (e) => {
      this.settings.skeleton = e.target.checked;
      this.overlay.showSkeleton = e.target.checked;
      this.saveSettings();
    });

    for (const tab of document.querySelectorAll('.tabs button')) {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b === tab));
        document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('active', p.dataset.panel === tab.dataset.tab));
      });
    }

    $('rec-audio').addEventListener('click', () => this.toggleAudioRecording());
    $('rec-midi').addEventListener('click', () => this.toggleMidiRecording());
    $('loop-clear').addEventListener('click', () => {
      this.looper.clear();
      this.notify('🔁 Boucles effacées');
    });
    $('midi-out').addEventListener('change', (e) => this.midi.select(e.target.value));

    // Calibration
    $('cal-open').addEventListener('click', () => this.calibrate('open'));
    $('cal-fist').addEventListener('click', () => this.calibrate('fist'));
    $('cal-low').addEventListener('click', () => this.calibrate('low'));
    $('cal-high').addEventListener('click', () => this.calibrate('high'));
    $('cal-reset').addEventListener('click', () => {
      this.calibration = { thresholds: { ...DEFAULT_THRESHOLDS }, heightMin: 0.1, heightMax: 0.9, open: null, fist: null };
      this.tracker.thresholds = { ...DEFAULT_THRESHOLDS };
      saveJSON(CALIB_KEY, this.calibration);
      this.renderThresholds();
      $('cal-status').textContent = 'Calibration réinitialisée.';
    });

    // Apprendre (KNN)
    $('learn-record').addEventListener('click', () => this.learnRecord());
    $('learn-export').addEventListener('click', () => download(JSON.stringify(this.knn.toJSON()), `gestes-perso-${stamp()}.json`, 'application/json'));
    $('learn-import').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      this.knn.load(JSON.parse(await file.text()));
      this.knn.save();
      this.renderKnn();
    });
    $('learn-clear').addEventListener('click', () => {
      if (!confirm('Effacer tous les gestes appris ?')) return;
      this.knn.clear();
      this.knn.save();
      this.renderKnn();
    });

    // Données
    $('data-subject').addEventListener('change', (e) => {
      this.dataset.subject = e.target.value.trim() || 'joueur1';
    });
    $('data-pose-record').addEventListener('click', () => this.dataRecordPoses());
    $('data-seq-record').addEventListener('click', () => this.dataRecordSequence());
    $('data-export').addEventListener('click', () => download(JSON.stringify(this.dataset.toJSON()), `dataset-geste-musique-${stamp()}.json`, 'application/json'));
    $('data-import').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        this.dataset.load(JSON.parse(await file.text()));
      } catch (err) {
        alert(err.message);
      }
      this.renderDataStats();
    });
    $('data-clear').addEventListener('click', () => {
      if (!confirm('Vider le jeu de données en mémoire ?')) return;
      this.dataset.clear();
      this.renderDataStats();
    });

    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.key >= '1' && e.key <= String(MODES.length)) this.setMode(MODES[+e.key - 1].id);
      else if (e.key === ' ') {
        e.preventDefault();
        this.engine.stopAll();
        this.looper.stop();
      } else if (e.key === 'v' || e.key === 'V') {
        this.locked = !this.locked;
        this.notify(this.locked ? '🔒 Jeu verrouillé' : '🔓 Jeu déverrouillé');
      } else if (e.key === 'b' || e.key === 'B') {
        this.looper.toggleRecord();
        this.notify(`🔁 Boucle : ${this.looper.status()}`);
      }
    });
  }

  renderModeHelp() {
    $('mode-name').textContent = this.mode.name;
    $('mode-help').innerHTML = this.mode.help.map(([g, a]) => `<tr><td>${g}</td><td>${a}</td></tr>`).join('');
  }

  renderThresholds() {
    const defs = [
      ['extendedBend', 'Doigt tendu si courbure <', 20, 160, 1],
      ['foldedBend', 'Doigt replié si courbure >', 60, 260, 1],
      ['thumbOut', 'Pouce écarté si distance >', 0.2, 1.4, 0.01],
      ['pinch', 'Pince / OK si distance <', 0.05, 0.8, 0.01],
      ['spread', 'V si écart index-majeur >', 0.1, 0.8, 0.01],
      ['openSpread', 'Main ouverte si écart moyen >', 0.1, 0.8, 0.01],
    ];
    const root = $('thresholds');
    root.innerHTML = '';
    for (const [key, label, min, max, step] of defs) {
      const row = document.createElement('label');
      const value = this.tracker.thresholds[key];
      row.innerHTML = `<span>${label}</span><input type="range" min="${min}" max="${max}" step="${step}" value="${value}"><output>${(+value).toFixed(step < 1 ? 2 : 0)}</output>`;
      const input = row.querySelector('input');
      input.addEventListener('input', () => {
        this.tracker.thresholds[key] = +input.value;
        this.calibration.thresholds = { ...this.tracker.thresholds };
        row.querySelector('output').textContent = (+input.value).toFixed(step < 1 ? 2 : 0);
        saveJSON(CALIB_KEY, this.calibration);
      });
      root.append(row);
    }
  }

  renderKnn() {
    const counts = this.knn.countByLabel();
    $('learn-list').innerHTML = '';
    for (const [label, n] of Object.entries(counts)) {
      const li = document.createElement('li');
      li.innerHTML = `<span><strong></strong> — ${n} exemples</span>`;
      li.querySelector('strong').textContent = label;
      const del = document.createElement('button');
      del.textContent = '✕';
      del.className = 'danger';
      del.addEventListener('click', () => {
        this.knn.removeLabel(label);
        this.knn.save();
        this.renderKnn();
      });
      li.append(del);
      $('learn-list').append(li);
    }
    if (!Object.keys(counts).length) $('learn-list').innerHTML = '<li class="hint">Aucun geste appris.</li>';
  }

  renderDataStats() {
    const s = this.dataset.stats();
    const fmt = (o) => Object.entries(o).map(([k, v]) => `  ${k}: ${v}`).join('\n') || '  (aucun)';
    $('data-stats').textContent = `Poses (${this.dataset.poses.length}) :\n${fmt(s.poses)}\nSéquences (${this.dataset.sequences.length}) :\n${fmt(s.sequences)}`;
  }

  setMode(id) {
    const next = findMode(id);
    if (this.running && this.mode) {
      this.mode.exit?.(this);
      this.engine.releaseAll();
    }
    this.mode = next;
    this.hudValues = {};
    if (this.running) this.mode.enter?.(this);
    this.settings.mode = next.id;
    this.saveSettings();
    $('mode').value = next.id;
    this.renderModeHelp();
    if (this.running) this.notify(`Mode : ${next.name}`);
  }

  async start() {
    if (this.running) return;
    const btn = $('start');
    btn.disabled = true;
    btn.textContent = 'Chargement…';
    try {
      await this.engine.start();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user', frameRate: { ideal: 30 } },
        audio: false,
      });
      const video = $('video');
      video.srcObject = stream;
      await video.play();
      $('stage').style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
      const info = await this.detector.init({ numHands: 2 });
      $('splash').hidden = true;

      const status = [`Détecteur : MediaPipe Hand Landmarker (${info.delegate})`, `Modèle : ${info.model}`];
      try {
        this.tracker.poseModel = await PoseModel.load();
        status.push(this.tracker.poseModel ? `Poses (TF.js) : ${this.tracker.poseModel.labels.join(', ')}` : 'Poses : règles géométriques (pas de models/pose/)');
      } catch (err) {
        status.push(`Poses : erreur de chargement (${err.message})`);
      }
      try {
        this.dynamicModel = await DynamicModel.load();
        status.push(this.dynamicModel ? `Mouvements (TF.js) : ${this.dynamicModel.labels.join(', ')}` : 'Mouvements : détecteurs à règles (pas de models/dynamic/)');
      } catch (err) {
        status.push(`Mouvements : erreur de chargement (${err.message})`);
      }
      $('model-status').textContent = status.join('\n');

      // MIDI en arrière-plan : certains navigateurs demandent une permission qui peut rester en attente.
      if (!this.midi.supported) $('midi-out').disabled = true;
      else {
        this.midi.init().then((outputs) => {
          for (const o of outputs) $('midi-out').append(new Option(o.name, o.id));
        });
      }

      this.running = true;
      this.mode.enter?.(this);
      btn.textContent = '● En cours';
      this.notify('Prêt ! Montrez vos mains.');
      this.loop();
    } catch (err) {
      console.error(err);
      btn.disabled = false;
      btn.textContent = '▶ Réessayer';
      alert(`Impossible de démarrer : ${err.message}`);
    }
  }

  loop() {
    const video = $('video');
    let lastTime = -1;
    const step = () => {
      if (video.currentTime !== lastTime && video.readyState >= 2) {
        lastTime = video.currentTime;
        this.processFrame(video);
      }
      if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(step);
      else requestAnimationFrame(step);
    };
    step();
  }

  processFrame(video) {
    const t0 = performance.now();
    const result = this.detector.detect(video, t0);
    const t1 = performance.now();
    const frame = this.tracker.update(result, t1);
    this.frame = frame;
    this.frameCount++;

    // Modèle de mouvements (optionnel), toutes les 3 images.
    if (this.dynamicModel && this.frameCount % 3 === 0) {
      for (const role of ['left', 'right']) {
        if (!frame.hands[role]) continue;
        const pred = this.dynamicModel.predict(this.tracker.window(role));
        if (pred && pred.confidence > 0.85 && !['none', 'no_gesture'].includes(pred.label) && this.dynamicCd[role].ready(t1)) {
          frame.events.push({ type: 'dynamic', label: pred.label, confidence: pred.confidence, hand: role, t: t1 });
        }
      }
    }

    for (const e of frame.events) {
      if (e.type === 'pose_enter') this.log(`${e.hand === 'left' ? 'G' : 'D'} ${POSE_NAMES[e.label] ?? e.label}`);
      else if (/^(swipe|circle|shake|clap|dynamic)/.test(e.type)) this.log(`${e.hand} ${e.type}${e.label ? ` ${e.label}` : ''}`);
    }

    if (this.capture) this.capture.onFrame(frame);
    else if (this.global.handle(frame)) this.mode.frame(this, frame);

    this.overlay.draw(frame, this.mode, this);

    // Performances et panneau (10 fois par seconde suffit).
    this.perf.detectMs.push(t1 - t0);
    this.perf.frames.push(t1);
    if (this.perf.detectMs.length > 60) this.perf.detectMs.shift();
    while (this.perf.frames.length && t1 - this.perf.frames[0] > 1000) this.perf.frames.shift();
    if (t1 - this.perf.lastUi > 100) {
      this.perf.lastUi = t1;
      this.updatePanel(frame);
    }
  }

  updatePanel(frame) {
    for (const role of ['left', 'right']) {
      const h = frame.hands[role];
      const el = $(`hand-${role}`);
      if (!h) {
        el.textContent = '—';
        continue;
      }
      const model = h.modelLabel ? ` · modèle ${h.modelLabel.label} ${Math.round(h.modelLabel.confidence * 100)} %` : '';
      el.textContent = `${POSE_NAMES[h.label] ?? h.label} · ${h.count ?? '?'} doigt(s)\nhaut ${Math.round(this.normHeight(h.height) * 100)} % · pince ${h.pinch.toFixed(2)}${model}`;
      el.style.whiteSpace = 'pre-line';
    }
    $('hud-note').textContent = this.hudValues.note ?? '—';
    $('hud-chord').textContent = this.hudValues.chord ?? '—';
    $('hud-tempo').textContent = this.hudValues.tempo ?? '—';
    $('hud-loop').textContent = this.looper.status();
    $('lock').hidden = !this.locked;
    if (this.mode.id === 'custom' || document.querySelector('[data-panel="learn"].active')) {
      const hand = frame.hands.right ?? frame.hands.left;
      const pred = hand ? this.knn.predict(hand.features) : null;
      $('learn-pred').textContent = pred ? `${pred.label} (${Math.round(pred.confidence * 100)} %)` : '—';
    }
    const fps = this.perf.frames.length;
    $('perf').textContent = `Images/s : ${fps}\nDétection : ${mean(this.perf.detectMs).toFixed(1)} ms\nAccélération : ${this.detector.delegate}`;
  }

  // --- Captures (calibration, apprentissage, données) ---------------------------------------

  /** Compte à rebours puis appelle onFrame pendant `ms`. */
  async runCapture(statusEl, label, ms, onFrame) {
    if (!this.running) {
      alert('Cliquez d\'abord sur Démarrer.');
      return false;
    }
    if (this.capture) return false;
    this.engine.releaseAll();
    for (let i = 3; i > 0; i--) {
      statusEl.textContent = `${label} dans ${i}…`;
      await sleep(600);
    }
    statusEl.textContent = `${label} : enregistrement…`;
    const end = performance.now() + ms;
    await new Promise((resolve) => {
      this.capture = {
        onFrame: (frame) => {
          onFrame(frame);
          if (performance.now() >= end) {
            this.capture = null;
            resolve();
          }
        },
      };
    });
    return true;
  }

  pickHand(frame) {
    return frame.hands.right ?? frame.hands.left;
  }

  async calibrate(step) {
    const names = { open: 'Main ouverte', fist: 'Poing', low: 'Main en bas', high: 'Main en haut' };
    const samples = [];
    const ok = await this.runCapture($('cal-status'), names[step], 1500, (frame) => {
      const h = this.pickHand(frame);
      if (!h) return;
      const size = dist(h.world[LM.WRIST], h.world[LM.MIDDLE_MCP]);
      samples.push({
        maxBend: Math.max(...h.bends.slice(1)),
        minBend: Math.min(...h.bends.slice(1)),
        thumb: dist(h.world[LM.THUMB_TIP], h.world[LM.INDEX_MCP]) / size,
        height: h.height,
      });
    });
    if (!ok) return;
    if (samples.length < 5) {
      $('cal-status').textContent = 'Main non détectée, recommencez.';
      return;
    }
    const c = this.calibration;
    if (step === 'open') c.open = { bend: mean(samples.map((s) => s.maxBend)), thumb: mean(samples.map((s) => s.thumb)) };
    if (step === 'fist') c.fist = { bend: mean(samples.map((s) => s.minBend)), thumb: mean(samples.map((s) => s.thumb)) };
    if (step === 'low') c.heightMin = Math.max(0, mean(samples.map((s) => s.height)) - 0.03);
    if (step === 'high') c.heightMax = Math.min(1, mean(samples.map((s) => s.height)) + 0.03);
    let msg = `${names[step]} : OK.`;
    if (c.open && c.fist && c.fist.bend > c.open.bend) {
      const span = c.fist.bend - c.open.bend;
      this.tracker.thresholds.extendedBend = c.open.bend + 0.35 * span;
      this.tracker.thresholds.foldedBend = c.open.bend + 0.75 * span;
      if (c.open.thumb > c.fist.thumb) this.tracker.thresholds.thumbOut = (c.open.thumb + c.fist.thumb) / 2;
      c.thresholds = { ...this.tracker.thresholds };
      msg += ' Seuils des doigts ajustés.';
      this.renderThresholds();
    }
    saveJSON(CALIB_KEY, c);
    $('cal-status').textContent = msg;
  }

  async learnRecord() {
    const name = $('learn-name').value.trim();
    if (!name) {
      alert('Donnez un nom au geste.');
      return;
    }
    let n = 0;
    const ok = await this.runCapture($('learn-pred'), name, 2000, (frame) => {
      const h = this.pickHand(frame);
      if (h && this.frameCount % 2 === 0) {
        this.knn.add(name, h.features);
        n++;
      }
    });
    if (!ok) return;
    this.knn.save();
    this.renderKnn();
    this.notify(`🧠 ${n} exemples ajoutés pour « ${name} »`);
  }

  async dataRecordPoses() {
    const label = $('data-pose-label').value;
    let n = 0;
    const ok = await this.runCapture($('data-status'), label, 3000, (frame) => {
      const h = this.pickHand(frame);
      if (h && this.frameCount % 3 === 0) {
        this.dataset.addPose(label, h);
        n++;
      }
    });
    if (!ok) return;
    $('data-status').textContent = `${n} poses « ${label} » ajoutées.`;
    this.renderDataStats();
  }

  async dataRecordSequence() {
    const label = $('data-seq-label').value;
    let role = 'right';
    const ok = await this.runCapture($('data-status'), `${label} (faites le geste)`, 1500, (frame) => {
      if (!frame.hands.right && frame.hands.left) role = 'left';
    });
    if (!ok) return;
    const frames = [...this.tracker.window(role)];
    if (frames.filter((f) => f.hand).length < 10) {
      $('data-status').textContent = 'Main trop peu visible, recommencez.';
      return;
    }
    this.dataset.addSequence(label, frames);
    $('data-status').textContent = `Séquence « ${label} » ajoutée (${frames.length} images).`;
    this.renderDataStats();
  }

  // --- Enregistrements ------------------------------------------------------------------------

  async toggleAudioRecording() {
    const btn = $('rec-audio');
    if (!this.engine.ready) return alert('Cliquez d\'abord sur Démarrer.');
    if (!this.engine.recording) {
      this.engine.startRecording();
      btn.classList.add('recording');
      btn.textContent = '⏹ Audio';
    } else {
      const blob = await this.engine.stopRecording();
      btn.classList.remove('recording');
      btn.textContent = '⏺ Audio';
      if (blob) download(blob, `geste-musique-${stamp()}.webm`);
    }
  }

  toggleMidiRecording() {
    const btn = $('rec-midi');
    if (!this.engine.ready) return alert('Cliquez d\'abord sur Démarrer.');
    if (!this.midiCapture.active) {
      this.midiCapture.begin(this.engine.now());
      btn.classList.add('recording');
      btn.textContent = '⏹ MIDI';
    } else {
      const events = this.midiCapture.end();
      btn.classList.remove('recording');
      btn.textContent = '⏺ MIDI';
      if (events.length) download(this.midiCapture.toFile(events, 120), `geste-musique-${stamp()}.mid`, 'audio/midi');
      else this.notify('Aucune note enregistrée.');
    }
  }
}

const app = new App();
app.initUI();
window.gesteMusique = app; // pratique pour déboguer dans la console
