// Dessin du squelette des mains, des étiquettes et des zones du mode courant.

import { CONNECTIONS, LM } from '../core/landmarks.js';
import { POSE_NAMES } from '../core/rules.js';

const COLORS = { left: '#4fc3f7', right: '#ff8a65' };

export class Overlay {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.showSkeleton = true;
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(r.width * dpr);
    const h = Math.round(r.height * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.dpr = dpr;
    return { w: r.width, h: r.height };
  }

  draw(frame, mode, app) {
    const { w, h } = this.resize();
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (mode.draw) mode.draw(ctx, w, h, app, frame);
    if (!frame) return;
    for (const role of ['left', 'right']) {
      const hand = frame.hands[role];
      if (hand) this.drawHand(ctx, hand, w, h);
    }
    if (app.locked) {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 28px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('🔒 Verrouillé — tenez OK pour reprendre', w / 2, h / 2);
      ctx.textAlign = 'start';
    }
  }

  drawHand(ctx, hand, w, h) {
    const color = COLORS[hand.role];
    const P = hand.screen.map((p) => ({ x: p.x * w, y: p.y * h }));
    if (this.showSkeleton) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      for (const [a, b] of CONNECTIONS) {
        ctx.beginPath();
        ctx.moveTo(P[a].x, P[a].y);
        ctx.lineTo(P[b].x, P[b].y);
        ctx.stroke();
      }
      P.forEach((p, i) => {
        const tip = [4, 8, 12, 16, 20].includes(i);
        const finger = Math.floor((i - 1) / 4);
        const up = tip && hand.fingers[finger];
        ctx.fillStyle = up ? '#ffe066' : '#fff';
        ctx.beginPath();
        ctx.arc(p.x, p.y, tip ? 6 : 3.5, 0, Math.PI * 2);
        ctx.fill();
      });
    }
    const wrist = P[LM.WRIST];
    const text = `${hand.role === 'left' ? 'G' : 'D'} · ${POSE_NAMES[hand.label] ?? hand.label}${hand.count !== null ? ` · ${hand.count}` : ''}`;
    ctx.font = 'bold 15px system-ui';
    const tw = ctx.measureText(text).width;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(wrist.x - tw / 2 - 8, wrist.y + 12, tw + 16, 24);
    ctx.fillStyle = color;
    ctx.fillText(text, wrist.x - tw / 2, wrist.y + 29);
  }
}
