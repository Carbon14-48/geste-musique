// Mode batterie : quatre pads en bas de l'écran, une frappe de la main dans un pad le joue.
// La vitesse de la frappe donne la vélocité. Secouer = shaker, applaudir = clap,
// poing -> main ouverte en moins de 300 ms = cymbale. Les frappes donnent aussi le tempo.

import { DRUM_NAMES } from '../audio/engine.js';
import { TempoTracker } from '../core/motion.js';

const PADS = ['kick', 'snare', 'hihat', 'cymbal'];

export default {
  id: 'drums',
  name: 'Batterie',
  overrides: ['fists', 'swipe'],
  help: [
    ['Frappe de la main dans un pad', 'Grosse caisse, caisse claire, charleston, cymbale'],
    ['Vitesse de la frappe', 'Force du coup'],
    ['Secouer la main', 'Shaker'],
    ['Applaudir', 'Clap'],
    ['Poing → main ouverte (rapide)', 'Cymbale'],
  ],
  enter() {
    this.flash = {};
    this.tempo = new TempoTracker();
    this.lastFistExit = { left: -Infinity, right: -Infinity };
  },
  exit() {},
  frame(app, frame) {
    const { engine } = app;
    const hit = (pad, vel, t) => {
      engine.drum(pad, vel);
      this.flash[pad] = t;
    };
    for (const e of frame.events) {
      const hand = frame.hands[e.hand];
      if (e.type === 'strike' && hand) {
        if (hand.palm.y < 0.45) continue; // frappe trop haute : hors des pads
        const pad = PADS[Math.max(0, Math.min(PADS.length - 1, Math.floor(hand.palm.x * PADS.length)))];
        hit(pad, Math.max(0.2, Math.min(1, e.speed / 18)), frame.t);
        const bpm = this.tempo.tap(frame.t);
        if (bpm) app.hud('tempo', `${bpm} BPM`);
        app.hud('note', DRUM_NAMES[pad]);
      } else if (e.type === 'shake') {
        hit('shaker', 0.6, frame.t);
      } else if (e.type === 'clap') {
        hit('clap', 0.9, frame.t);
      } else if (e.type === 'pose_exit' && e.label === 'fist') {
        this.lastFistExit[e.hand] = e.t;
      } else if (e.type === 'pose_enter' && (e.label === 'open' || e.label === 'palm')) {
        if (e.t - this.lastFistExit[e.hand] < 300) hit('cymbal', 1, frame.t);
      }
    }
  },
  draw(ctx, w, h, app, frame) {
    const padW = w / PADS.length;
    const top = h * 0.55;
    ctx.save();
    ctx.font = '14px system-ui';
    ctx.textAlign = 'center';
    PADS.forEach((pad, i) => {
      const lit = frame && frame.t - (this.flash[pad] ?? -1e9) < 150;
      ctx.fillStyle = lit ? 'rgba(255, 90, 60, 0.7)' : 'rgba(255,255,255,0.13)';
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      const x = i * padW + 6;
      ctx.beginPath();
      ctx.roundRect(x, top, padW - 12, h - top - 10, 14);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fillText(DRUM_NAMES[pad], x + (padW - 12) / 2, h - 22);
    });
    ctx.restore();
  },
};
