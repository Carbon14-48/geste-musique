// Dessin du squelette des mains, des étiquettes et des zones du mode courant.

import { CONNECTIONS, LM } from '../core/landmarks.js';
import { POSE_NAMES } from '../core/rules.js';
import * as P from '../core/palette.js';
import { roundRect } from '../core/canvasUtils.js';

const COLORS = { left: P.LEFT, right: P.RIGHT };

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
      ctx.fillStyle = 'rgba(11, 7, 32, 0.45)';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = P.INK;
      ctx.font = `700 26px ${P.SANS}`;
      ctx.textAlign = 'center';
      ctx.fillText('🔒 verrouillé — tiens OK pour reprendre', w / 2, h / 2);
      ctx.textAlign = 'start';
    }
  }

  drawHand(ctx, hand, w, h) {
    const color = COLORS[hand.role];
    const rgb = hand.role === 'left' ? P.LEFT_RGB : P.RIGHT_RGB;
    const P2 = hand.screen.map((p) => ({ x: p.x * w, y: p.y * h }));

    // Halo doux autour du poignet (dégradé radial, pas de shadowBlur coûteux).
    const wrist = P2[LM.WRIST];
    const mid = P2[LM.MIDDLE_MCP];
    const handSize = Math.hypot(mid.x - wrist.x, mid.y - wrist.y) * 3.2;
    const glow = ctx.createRadialGradient(wrist.x, wrist.y, 0, wrist.x, wrist.y, handSize);
    glow.addColorStop(0, `rgba(${rgb}, 0.2)`);
    glow.addColorStop(1, `rgba(${rgb}, 0)`);
    ctx.fillStyle = glow;
    ctx.fillRect(wrist.x - handSize, wrist.y - handSize, handSize * 2, handSize * 2);

    if (this.showSkeleton) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      for (const [a, b] of CONNECTIONS) {
        ctx.beginPath();
        ctx.moveTo(P2[a].x, P2[a].y);
        ctx.lineTo(P2[b].x, P2[b].y);
        ctx.stroke();
      }
      P2.forEach((p, i) => {
        const tip = [4, 8, 12, 16, 20].includes(i);
        const finger = Math.floor((i - 1) / 4);
        const up = tip && hand.fingers[finger];
        ctx.fillStyle = up ? P.ACCENT : P.INK;
        ctx.beginPath();
        ctx.arc(p.x, p.y, tip ? 6 : 3.5, 0, Math.PI * 2);
        ctx.fill();
      });
    }
    const text = `${hand.role === 'left' ? 'gauche' : 'droite'} · ${POSE_NAMES[hand.label] ?? hand.label}${hand.count !== null ? ` · ${hand.count}` : ''}`;
    ctx.font = `600 14px ${P.SANS}`;
    const tw = ctx.measureText(text).width;
    roundRect(ctx, wrist.x - tw / 2 - 10, wrist.y + 10, tw + 20, 28, 14);
    ctx.fillStyle = 'rgba(11, 7, 32, 0.72)';
    ctx.fill();
    ctx.fillStyle = color;
    ctx.fillText(text, wrist.x - tw / 2, wrist.y + 29);
  }
}
