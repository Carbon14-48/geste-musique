// La « planche » : tout est dessiné dans un seul canvas (caméra + interface),
// ce qui permet d'enregistrer exactement ce qu'on voit, en large ou en vertical.

import { CONNECTIONS, LM } from '../core/landmarks.js';
import { drumBar, DRUM_FAMILIES, DRUM_LEVEL_NAMES } from './patterns.js';
import { ARC_MODES, ARC_NAMES } from './arc.js';
import { SPICE_NAMES } from './theory.js';
import { MELODY_LANES, laneLabel } from './rightModes.js';
import { PINCH_FINGERS } from './pinch.js';
import * as P from '../core/palette.js';
import { roundRect } from '../core/canvasUtils.js';

const SANS = P.SANS;

function label(ctx, text, x, y, { size = 13, color = P.DIM, align = 'left', weight = 500 } = {}) {
  ctx.save();
  ctx.font = `${weight} ${size}px ${SANS}`;
  ctx.fillStyle = color;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = align;
  ctx.fillText(text, x, y);
  ctx.restore();
  return ctx.measureText(text).width;
}

/** Petite pastille arrondie derrière un texte (messages éphémères, badges). */
function pill(ctx, x, y, w, h, color, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

function dial(ctx, x, y, r, value, title, color = P.ACCENT) {
  ctx.save();
  ctx.strokeStyle = P.FAINT;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(x, y, r, Math.PI * 0.75, Math.PI * 2.25);
  ctx.stroke();
  if (value !== null && value !== undefined) {
    const a = Math.PI * 0.75 + value * Math.PI * 1.5;
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, r, Math.PI * 0.75, a);
    ctx.stroke();
  }
  ctx.restore();
  label(ctx, `${title} ${value === null || value === undefined ? '—' : Math.round(value * 100) + ' %'}`, x + r + 12, y + 4, { size: 12 });
}

export class Plate {
  constructor() {
    this.messages = []; // {text, t}
    this.fade = { left: 0, right: 0 }; // opacité des panneaux (seul le côté de la main active s'affiche)
    this.lastRender = 0;
    this.lastChordName = null;
    this.chordChangeAt = 0;
  }

  /** Fait glisser l'opacité d'un panneau vers 1 (côté actif) ou 0, en ~300 ms. */
  updateFade(side, active, dt) {
    const step = dt / 300;
    const f = this.fade[side];
    this.fade[side] = active ? Math.min(1, f + step) : Math.max(0, f - step);
    return this.fade[side];
  }

  say(text, { big = false } = {}) {
    this.messages.push({ text, t: performance.now(), big });
    if (this.messages.length > 3) this.messages.shift();
  }

  /** Rectangle où la vidéo est dessinée (remplissage « cover »). */
  videoRect(video, w, h) {
    const vw = video?.videoWidth || 16;
    const vh = video?.videoHeight || 9;
    const s = Math.max(w / vw, h / vh);
    return { x: (w - vw * s) / 2, y: (h - vh * s) / 2, w: vw * s, h: vh * s };
  }

  /** Fond animé : trois taches de couleur qui dérivent lentement (dégradés radiaux, peu coûteux). */
  drawBlobs(ctx, w, h, t, blend) {
    ctx.save();
    if (blend) ctx.globalCompositeOperation = 'screen';
    const specs = [
      { color: P.BLOB_COLORS[0], fx: 0.28, fy: 0.22, sx: 0.09, sy: 0.07, speed: 0.00012, r: 0.75 },
      { color: P.BLOB_COLORS[1], fx: 0.78, fy: 0.68, sx: 0.08, sy: 0.1, speed: 0.00009, r: 0.7 },
      { color: P.BLOB_COLORS[2], fx: 0.55, fy: 0.85, sx: 0.1, sy: 0.06, speed: 0.00015, r: 0.65 },
    ];
    const minDim = Math.min(w, h);
    for (const s of specs) {
      const cx = (s.fx + Math.sin(t * s.speed + s.fx * 10) * s.sx) * w;
      const cy = (s.fy + Math.cos(t * s.speed * 1.3 + s.fy * 10) * s.sy) * h;
      const r = minDim * s.r;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, `${s.color}55`);
      g.addColorStop(1, `${s.color}00`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.restore();
  }

  /** Ondes sonores animées derrière l'écran d'accueil (avant de démarrer). */
  drawWaves(ctx, w, h, t) {
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const cy = h * 0.55;
    const waves = [
      { amp: h * 0.045, freq: 0.006, speed: 0.0012, color: P.ACCENT, phase: 0 },
      { amp: h * 0.03, freq: 0.009, speed: -0.0009, color: P.ACCENT_2, phase: 2 },
      { amp: h * 0.022, freq: 0.012, speed: 0.0015, color: P.MODE_COLORS.fx, phase: 4 },
    ];
    for (const wv of waves) {
      ctx.beginPath();
      for (let x = 0; x <= w; x += 10) {
        const y = cy + Math.sin(x * wv.freq + t * wv.speed + wv.phase) * wv.amp;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = `${wv.color}40`;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.restore();
  }

  render(ctx, w, h, S) {
    const portrait = h > w;
    const m = 18;
    ctx.save();
    ctx.fillStyle = P.BG;
    ctx.fillRect(0, 0, w, h);

    const now0 = performance.now();
    const dt = this.lastRender ? Math.min(100, now0 - this.lastRender) : 16;
    this.lastRender = now0;

    if (!S.started) {
      this.drawBlobs(ctx, w, h, now0, false);
      this.drawWaves(ctx, w, h, now0);
    }

    // Caméra en miroir, éclaircie si « améliorer l'image » est coché (MediaPipe reçoit l'image brute).
    const vr = this.videoRect(S.video, w, h);
    if (S.video && S.video.readyState >= 2) {
      ctx.save();
      if (S.mirror) {
        ctx.translate(w, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(S.video, w - vr.x - vr.w, vr.y, vr.w, vr.h);
      } else {
        ctx.drawImage(S.video, vr.x, vr.y, vr.w, vr.h);
      }
      ctx.restore();
    }
    ctx.fillStyle = `rgba(11, 7, 32, ${S.scrim ?? 0.25})`;
    ctx.fillRect(0, 0, w, h);
    if (S.started) this.drawBlobs(ctx, w, h, now0, true);

    // En-tête : tonalité + tempo, et enregistrement en cours.
    const pad = m + 10;
    label(ctx, `${S.keyName} · ${S.bpm} bpm`, w - pad, m + 24, { align: 'right', size: 13, color: P.DIM });
    if (S.recording) {
      const blink = Math.floor(now0 / 500) % 2 === 0;
      pill(ctx, w - pad - 108, m + 32, 108, 26, P.DANGER, blink ? 1 : 0.5);
      label(ctx, `● REC ${S.recordingTime ?? ''}`, w - pad - 54, m + 49, { align: 'center', size: 12, color: '#190508', weight: 700 });
    }

    // Panneaux.
    const panelW = portrait ? w - 2 * pad : Math.min(360, w * 0.3);
    const leftBox = portrait
      ? { x: pad, y: m + 56, w: panelW, h: h * 0.3 }
      : { x: pad, y: m + 56, w: panelW, h: h - 2 * m - 110 };
    const rightBox = portrait
      ? { x: pad, y: h * 0.58, w: panelW, h: h * 0.42 - m - 40 }
      : { x: w - pad - panelW, y: m + 56, w: panelW, h: h - 2 * m - 110 };
    const leftOn = this.updateFade('left', !!(S.hands?.left || S.chord), dt);
    const rightOn = this.updateFade('right', !!(S.hands?.right || S.arc?.open || (S.pinchFinger ?? null) !== null), dt);
    const modeColor = S.mode ? P.MODE_COLORS[S.mode] : P.ACCENT;
    if (S.started) {
      for (const [box, on, draw] of [
        [leftBox, leftOn, () => this.drawLeftPanel(ctx, leftBox, S, portrait)],
        [rightBox, rightOn, () => this.drawRightPanel(ctx, rightBox, S, portrait, modeColor)],
      ]) {
        if (on <= 0) continue;
        ctx.save();
        ctx.globalAlpha = on;
        roundRect(ctx, box.x - 16, box.y - 26, box.w + 32, box.h + 44, 20);
        ctx.fillStyle = 'rgba(14, 9, 38, 0.55)';
        ctx.fill();
        ctx.strokeStyle = P.FAINT;
        ctx.lineWidth = 1;
        ctx.stroke();
        draw();
        ctx.restore();
      }
    }

    // Mains et arc.
    for (const role of ['left', 'right']) {
      const hand = S.hands?.[role];
      if (hand) this.drawHand(ctx, hand, vr, role, role === 'right' ? S.pinchFinger : null);
    }
    if (S.arc?.open && S.hands?.right) this.drawArc(ctx, S.arc, S.hands.right, vr, Math.min(w, h));

    // Messages éphémères, en petites bulles.
    const now = performance.now();
    this.messages = this.messages.filter((msg) => now - msg.t < 2200);
    this.messages.forEach((msg, i) => {
      const alpha = Math.min(1, (2200 - (now - msg.t)) / 400);
      const size = msg.big ? 22 : 13;
      const boxH = msg.big ? 52 : 32;
      const y = h - m - 70 - (this.messages.length - 1 - i) * (boxH + 6);
      ctx.font = `${msg.big ? 700 : 500} ${size}px ${SANS}`;
      const tw = ctx.measureText(msg.text).width;
      pill(ctx, w / 2 - tw / 2 - 20, y - boxH / 2 - 6, tw + 40, boxH, msg.big ? P.ACCENT : 'rgba(20, 13, 51, 0.92)', alpha);
      label(ctx, msg.text, w / 2, y, { size, align: 'center', weight: msg.big ? 700 : 500, color: msg.big ? `rgba(25, 5, 8, ${alpha})` : `rgba(243, 241, 251, ${alpha})` });
    });

    if (S.muted) {
      ctx.fillStyle = 'rgba(11, 7, 32, 0.68)';
      ctx.fillRect(0, 0, w, h);
      ctx.font = `600 ${Math.min(96, w * 0.09)}px ${SANS}`;
      ctx.fillStyle = P.INK;
      ctx.textAlign = 'center';
      ctx.fillText('silence', w / 2, h / 2);
      ctx.textAlign = 'left';
      label(ctx, 'ouvre les mains pour reprendre · plus de 1,5 s = tout s\'arrête', w / 2, h / 2 + 36, { size: 13, align: 'center' });
    }
    if (!S.hands?.left && !S.hands?.right && S.started && !S.muted) {
      label(ctx, 'montre tes deux mains · recule jusqu\'à voir tes coudes', w / 2, h / 2, { size: 15, align: 'center' });
    }
    ctx.restore();
  }

  drawLeftPanel(ctx, b, S, portrait) {
    label(ctx, `main gauche · accords · ${S.instrument ?? ''}`, b.x, b.y, { size: 12, color: P.DIM });
    const c = S.chord;
    if (c && c.name !== this.lastChordName) {
      this.lastChordName = c.name;
      this.chordChangeAt = performance.now();
    }
    const chordColor = c ? P.CHORD_COLORS[(c.chord?.degree ?? 0) % P.CHORD_COLORS.length] : P.DIM;
    const pulse = c ? Math.max(0, 1 - (performance.now() - this.chordChangeAt) / 350) : 0;
    const big = portrait ? Math.min(78, b.w * 0.19) : Math.min(90, b.w * 0.26);
    ctx.save();
    ctx.font = `700 ${big * (1 + pulse * 0.12)}px ${SANS}`;
    ctx.fillStyle = c ? chordColor : P.FAINT;
    ctx.fillText(c ? c.name : '—', b.x, b.y + big + 14);
    ctx.restore();
    const info = c ? [c.roman, SPICE_NAMES[c.spice], c.flip ? 'parallèle' : null, c.flat ? 'demi-ton bas' : null].filter(Boolean).join(' · ') : 'compte un nombre sur tes doigts';
    label(ctx, info, b.x, b.y + big + 38, { size: 13, color: c ? P.INK : P.DIM });

    // Échelle des épices : la hauteur de la main enrichit l'accord.
    const ladderTop = b.y + big + 66;
    const cellH = portrait ? 22 : 32;
    const ladderW = 128;
    label(ctx, 'hauteur · richesse', b.x, ladderTop - 8, { size: 12 });
    for (let i = 0; i < 4; i++) {
      const y = ladderTop + (3 - i) * (cellH + 6);
      const on = c && c.spice === i;
      roundRect(ctx, b.x, y, ladderW, cellH, 8);
      ctx.fillStyle = on ? chordColor : 'rgba(255,255,255,0.05)';
      ctx.fill();
      if (!on) {
        ctx.strokeStyle = P.FAINT;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      label(ctx, SPICE_NAMES[i], b.x + 12, y + cellH / 2 + 4, { size: 12, color: on ? '#190508' : P.DIM, weight: on ? 700 : 500 });
    }
    if (S.leftHeight !== null && S.leftHeight !== undefined) {
      const total = 4 * (cellH + 6) - 6;
      const y = ladderTop + total * (1 - S.leftHeight);
      ctx.strokeStyle = P.ACCENT;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(b.x + ladderW + 8, y);
      ctx.lineTo(b.x + ladderW + 26, y);
      ctx.stroke();
    }
    const dialY = ladderTop + 4 * (cellH + 6) + 34;
    if (dialY < b.y + b.h + 40) dial(ctx, b.x + 22, dialY, 18, S.leftRoll, 'filtre');
    if (dialY + 30 < b.y + b.h + 40) label(ctx, 'pouce + index/auriculaire = instrument', b.x, dialY + 36, { size: 12, color: P.DIM });
  }

  drawRightPanel(ctx, b, S, portrait, modeColor) {
    const mode = S.mode;
    label(ctx, mode ? `main droite · ${ARC_NAMES[mode]}` : 'main droite', b.x, b.y, { size: 12, color: mode ? modeColor : P.DIM, weight: 700 });
    const st = S.modeState;
    let y = b.y + 24;
    if (!mode || !st) {
      label(ctx, 'poing, dos de la main vers la caméra', b.x, y + 10, { size: 13, color: P.INK });
      label(ctx, '→ l\'arc des modes apparaît', b.x, y + 32, { size: 13 });
      label(ctx, 'glisse · ouvre la main pour choisir', b.x, y + 54, { size: 13 });
      return;
    }
    const f = S.pinchFinger;
    const rowH = portrait ? 22 : 30;
    if (mode === 'drums') {
      // Sélecteur : le nombre de doigts levés choisit le rythme, le niveau actif ressort en couleur.
      const gap = 10;
      const selW = (b.w - 3 * gap) / 4;
      for (let i = 1; i <= 4; i++) {
        const x = b.x + (i - 1) * (selW + gap);
        const on = st.level === i;
        roundRect(ctx, x, y, selW, 44, 12);
        ctx.fillStyle = on ? modeColor : 'rgba(255,255,255,0.06)';
        ctx.fill();
        if (!on) {
          ctx.strokeStyle = P.FAINT;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
        label(ctx, String(i), x + selW / 2, y + 20, { size: 16, align: 'center', color: on ? '#190508' : P.INK, weight: 700 });
        label(ctx, DRUM_LEVEL_NAMES[i], x + selW / 2, y + 36, { size: 10, align: 'center', color: on ? '#190508' : P.DIM });
      }
      y += 60;

      const cell = Math.min(16, (b.w - 4) / 16 - 2);
      DRUM_FAMILIES.forEach((fam, r) => {
        const ry = y + 14 + r * (rowH + 12);
        label(ctx, st.tracks[r], b.x, ry, { size: 12, color: st.level > 0 ? modeColor : P.DIM });
        const vel = drumBar(fam, st.levels[r], S.bar ?? 0);
        for (let s = 0; s < 16; s++) {
          const x = b.x + s * (cell + 2);
          const cy = ry + 6;
          roundRect(ctx, x, cy, cell, cell, 3);
          ctx.strokeStyle = s === S.step ? P.INK : P.FAINT;
          ctx.lineWidth = 1;
          ctx.stroke();
          if (vel[s] > 0) {
            ctx.fillStyle = `${modeColor}${Math.round((0.3 + vel[s] * 0.6) * 255).toString(16).padStart(2, '0')}`;
            roundRect(ctx, x + 1.5, cy + 1.5, cell - 3, cell - 3, 2);
            ctx.fill();
          }
        }
      });
      y += 4 * (rowH + 12) + 20;
    } else if (mode === 'melody') {
      const laneH = Math.max(10, Math.min(22, (b.h - 80) / MELODY_LANES));
      for (let l = MELODY_LANES - 1; l >= 0; l--) {
        const ly = y + (MELODY_LANES - 1 - l) * laneH;
        const active = st.lanes.findIndex((x) => x === l);
        ctx.strokeStyle = P.FAINT;
        ctx.beginPath();
        ctx.moveTo(b.x + 36, ly + laneH / 2);
        ctx.lineTo(b.x + b.w, ly + laneH / 2);
        ctx.stroke();
        label(ctx, laneLabel(st.key, l), b.x, ly + laneH / 2 + 4, { size: 11, color: active >= 0 ? modeColor : P.DIM });
        if (active >= 0) {
          ctx.fillStyle = modeColor;
          ctx.beginPath();
          ctx.arc(b.x + 54 + active * 40, ly + laneH / 2, 6, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      if (S.rightHeight !== null && S.rightHeight !== undefined) {
        const hy = y + (1 - S.rightHeight) * MELODY_LANES * laneH;
        ctx.strokeStyle = P.DIM;
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.moveTo(b.x + 36, hy);
        ctx.lineTo(b.x + b.w, hy);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      y += MELODY_LANES * laneH + 16;
    } else {
      // Barres : basse, fx, sculpt.
      const values = mode === 'fx' ? st.amounts : st.values;
      st.tracks.forEach((name, r) => {
        const ry = y + 10 + r * (rowH + 10);
        const on = mode === 'fx' ? st.active[r] : f === r;
        label(ctx, name, b.x, ry, { size: 12, color: on ? modeColor : P.DIM });
        roundRect(ctx, b.x, ry + 6, b.w, 10, 5);
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.fill();
        const v = mode === 'fx' && !st.active[r] ? 0 : values[r];
        if (v > 0) {
          roundRect(ctx, b.x, ry + 6, Math.max(10, b.w * v), 10, 5);
          ctx.fillStyle = on ? modeColor : P.INK;
          ctx.fill();
        }
      });
      y += 4 * (rowH + 10) + 20;
    }
    label(ctx, f !== null && f !== undefined ? `pincé : ${PINCH_FINGERS[f]} · ${st.readout(f)}` : st.readout(null) || 'pince pouce + doigt pour choisir une piste', b.x, y, { size: 12, color: f !== null && f !== undefined ? P.INK : P.DIM });
    if (y + 48 < b.y + b.h + 40) dial(ctx, b.x + 22, y + 38, 18, S.rightRoll, 'rotation', modeColor);
  }

  drawHand(ctx, hand, vr, role, pinchFinger) {
    const color = role === 'left' ? P.LEFT : P.RIGHT;
    const rgb = role === 'left' ? P.LEFT_RGB : P.RIGHT_RGB;
    const P2 = hand.screen.map((p) => ({ x: vr.x + p.x * vr.w, y: vr.y + p.y * vr.h }));
    ctx.save();

    // Halo doux (dégradé radial autour du poignet, pas de shadowBlur coûteux).
    const wrist = P2[LM.WRIST];
    const mid = P2[LM.MIDDLE_MCP];
    const handSize = Math.hypot(mid.x - wrist.x, mid.y - wrist.y) * 3.2;
    const glow = ctx.createRadialGradient(wrist.x, wrist.y, 0, wrist.x, wrist.y, handSize);
    glow.addColorStop(0, `rgba(${rgb}, 0.22)`);
    glow.addColorStop(1, `rgba(${rgb}, 0)`);
    ctx.fillStyle = glow;
    ctx.fillRect(wrist.x - handSize, wrist.y - handSize, handSize * 2, handSize * 2);

    ctx.beginPath();
    for (const [a, bIdx] of CONNECTIONS) {
      ctx.moveTo(P2[a].x, P2[a].y);
      ctx.lineTo(P2[bIdx].x, P2[bIdx].y);
    }
    ctx.strokeStyle = 'rgba(11, 7, 32, 0.55)';
    ctx.lineWidth = 4.5;
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.fillStyle = P.INK;
    for (const p of P2) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
    if (pinchFinger !== null && pinchFinger !== undefined) {
      const tip = P2[[LM.INDEX_TIP, LM.MIDDLE_TIP, LM.RING_TIP, LM.PINKY_TIP][pinchFinger]];
      const th = P2[LM.THUMB_TIP];
      const cx = (tip.x + th.x) / 2;
      const cy = (tip.y + th.y) / 2;
      const g2 = ctx.createRadialGradient(cx, cy, 0, cx, cy, 22);
      g2.addColorStop(0, `rgba(${P.ACCENT_RGB}, 0.35)`);
      g2.addColorStop(1, `rgba(${P.ACCENT_RGB}, 0)`);
      ctx.fillStyle = g2;
      ctx.fillRect(cx - 22, cy - 22, 44, 44);
      ctx.strokeStyle = P.ACCENT;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(cx, cy, 14, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawArc(ctx, arc, hand, vr, scale) {
    const p = hand.screen[LM.WRIST];
    const x = vr.x + arc.anchor.x * vr.w;
    const y = vr.y + Math.min(p.y, arc.anchor.y) * vr.h;
    const R = scale * 0.2;
    const n = ARC_MODES.length;
    const start = Math.PI * 1.1;
    const span = (Math.PI * 0.8) / n;
    ctx.save();
    for (let i = 0; i < n; i++) {
      const a0 = start + i * span + 0.02;
      const a1 = start + (i + 1) * span - 0.02;
      const on = arc.hover === i;
      const color = P.MODE_COLORS[ARC_MODES[i]];
      ctx.beginPath();
      ctx.arc(x, y, R + 26, a0, a1);
      ctx.arc(x, y, R - 22, a1, a0, true);
      ctx.closePath();
      ctx.fillStyle = on ? color : `${color}33`;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.fill();
      ctx.stroke();
      const am = (a0 + a1) / 2;
      label(ctx, ARC_NAMES[ARC_MODES[i]], x + Math.cos(am) * (R + 2), y + Math.sin(am) * (R + 2) + 4, {
        size: 12,
        align: 'center',
        color: on ? '#190508' : P.INK,
        weight: 700,
      });
    }
    label(ctx, 'ouvrir = choisir · dos = annuler', x, y + 26, { size: 11, align: 'center', color: P.DIM });
    ctx.restore();
  }
}
