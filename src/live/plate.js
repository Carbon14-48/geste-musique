// La « planche » : tout est dessiné dans un seul canvas (caméra + interface),
// ce qui permet d'enregistrer exactement ce qu'on voit, en large ou en vertical.

import { CONNECTIONS, LM } from '../core/landmarks.js';
import { drumBar, DRUM_FAMILIES, DRUM_LEVEL_NAMES } from './patterns.js';
import { ARC_MODES, ARC_NAMES } from './arc.js';
import { SPICE_NAMES } from './theory.js';
import { MELODY_LANES, laneLabel } from './rightModes.js';
import { PINCH_FINGERS } from './pinch.js';

const INK = 'rgba(236, 233, 226, 0.92)';
const DIM = 'rgba(236, 233, 226, 0.5)';
const FAINT = 'rgba(236, 233, 226, 0.16)';
const ACCENT = '#f4c26b';
const BG = '#06070a';
const SANS = 'Geist, "Helvetica Neue", Arial, sans-serif';
const MONO = '"Geist Mono", ui-monospace, monospace';

function label(ctx, text, x, y, { size = 11, color = DIM, align = 'left', spacing = 0.22 } = {}) {
  ctx.save();
  ctx.font = `400 ${size}px ${MONO}`;
  ctx.fillStyle = color;
  ctx.textBaseline = 'alphabetic';
  const chars = text.toUpperCase().split('');
  const gap = size * spacing;
  const width = chars.reduce((w, c) => w + ctx.measureText(c).width + gap, -gap);
  let cx = align === 'right' ? x - width : align === 'center' ? x - width / 2 : x;
  for (const c of chars) {
    ctx.fillText(c, cx, y);
    cx += ctx.measureText(c).width + gap;
  }
  ctx.restore();
  return width;
}

function cross(ctx, x, y, s = 7) {
  ctx.beginPath();
  ctx.moveTo(x - s, y);
  ctx.lineTo(x + s, y);
  ctx.moveTo(x, y - s);
  ctx.lineTo(x, y + s);
  ctx.stroke();
}

function dial(ctx, x, y, r, value, title) {
  ctx.save();
  ctx.strokeStyle = FAINT;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(x, y, r, Math.PI * 0.75, Math.PI * 2.25);
  ctx.stroke();
  if (value !== null && value !== undefined) {
    const a = Math.PI * 0.75 + value * Math.PI * 1.5;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, r, Math.PI * 0.75, a);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * (r - 4), y + Math.sin(a) * (r - 4));
    ctx.stroke();
  }
  ctx.restore();
  label(ctx, `${title} ${value === null || value === undefined ? '—' : value.toFixed(2)}`, x + r + 10, y + 4, { size: 10 });
}

export class Plate {
  constructor() {
    this.messages = []; // {text, t}
  }

  say(text, t = performance.now()) {
    this.messages.push({ text, t });
    if (this.messages.length > 3) this.messages.shift();
  }

  /** Rectangle où la vidéo est dessinée (remplissage « cover »). */
  videoRect(video, w, h) {
    const vw = video?.videoWidth || 16;
    const vh = video?.videoHeight || 9;
    const s = Math.max(w / vw, h / vh);
    return { x: (w - vw * s) / 2, y: (h - vh * s) / 2, w: vw * s, h: vh * s };
  }

  render(ctx, w, h, S) {
    const portrait = h > w;
    const m = Math.round(Math.min(w, h) * 0.035) + 8;
    ctx.save();
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, w, h);

    // Caméra en miroir sous un voile sombre.
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
    ctx.fillStyle = `rgba(6, 7, 10, ${S.scrim ?? 0.5})`;
    ctx.fillRect(0, 0, w, h);

    // Cercles concentriques décoratifs.
    ctx.strokeStyle = 'rgba(236, 233, 226, 0.05)';
    ctx.lineWidth = 1;
    const cx = portrait ? w * 0.5 : w * 0.7;
    const cy = h * 0.5;
    for (const k of [0.12, 0.22, 0.34, 0.48]) {
      ctx.beginPath();
      ctx.arc(cx, cy, Math.min(w, h) * k, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Cadre fin et croix aux coins.
    ctx.strokeStyle = FAINT;
    ctx.strokeRect(m + 0.5, m + 0.5, w - 2 * m - 1, h - 2 * m - 1);
    ctx.strokeStyle = DIM;
    for (const [x, y] of [[m, m], [w - m, m], [m, h - m], [w - m, h - m]]) cross(ctx, x, y);

    // En-tête et pied.
    const pad = m + 18;
    label(ctx, portrait ? 'FIG. 01 · DEUX MAINS' : 'FIG. 01 · SURFACE DE CONTRÔLE À DEUX MAINS', pad, m + 28);
    label(ctx, `${S.keyName} · ${S.bpm} BPM`, w - pad, m + 28, { align: 'right' });
    if (S.recording) {
      const blink = Math.floor(performance.now() / 500) % 2 === 0;
      label(ctx, `${blink ? '●' : '○'} REC ${S.recordingTime ?? ''}`, w - pad, m + 46, { align: 'right', color: '#ff5d5d' });
    }
    label(ctx, 'GESTE LIVE · V1.0', pad, h - m - 16, { size: 10 });
    if (!portrait) label(ctx, 'NAVIGATEUR · RIEN À INSTALLER · RIEN N\'EST ENVOYÉ', w - pad, h - m - 16, { size: 10, align: 'right' });

    // Panneaux.
    const panelW = portrait ? w - 2 * pad : Math.min(360, w * 0.28);
    const leftBox = portrait
      ? { x: pad, y: m + 60, w: panelW, h: h * 0.3 }
      : { x: pad, y: m + 64, w: panelW, h: h - 2 * m - 120 };
    const rightBox = portrait
      ? { x: pad, y: h * 0.58, w: panelW, h: h * 0.42 - m - 40 }
      : { x: w - pad - panelW, y: m + 64, w: panelW, h: h - 2 * m - 120 };
    if (S.started) {
      this.drawLeftPanel(ctx, leftBox, S, portrait);
      this.drawRightPanel(ctx, rightBox, S, portrait);
    }

    // Mains et arc.
    for (const role of ['left', 'right']) {
      const hand = S.hands?.[role];
      if (hand) this.drawHand(ctx, hand, vr, role === 'right' ? S.pinchFinger : null);
    }
    if (S.arc?.open && S.hands?.right) this.drawArc(ctx, S.arc, S.hands.right, vr, Math.min(w, h));

    // Messages éphémères.
    const now = performance.now();
    this.messages = this.messages.filter((msg) => now - msg.t < 2200);
    this.messages.forEach((msg, i) => {
      const alpha = Math.min(1, (2200 - (now - msg.t)) / 400);
      label(ctx, msg.text, w / 2, h - m - 44 - (this.messages.length - 1 - i) * 18, {
        size: 12,
        align: 'center',
        color: `rgba(236, 233, 226, ${0.85 * alpha})`,
      });
    });

    if (!S.hands?.left && !S.hands?.right && S.started) {
      label(ctx, 'montrez vos deux mains · reculez jusqu\'à voir vos coudes', w / 2, h / 2, { size: 12, align: 'center' });
    }
    ctx.restore();
  }

  drawLeftPanel(ctx, b, S, portrait) {
    label(ctx, 'GAUCHE · ACCORDS', b.x, b.y);
    const c = S.chord;
    const big = portrait ? Math.min(84, b.w * 0.2) : Math.min(96, b.w * 0.28);
    ctx.save();
    ctx.font = `300 ${big}px ${SANS}`;
    ctx.fillStyle = c ? INK : FAINT;
    ctx.fillText(c ? c.name : '—', b.x - 4, b.y + big + 14);
    ctx.restore();
    const info = c ? [c.roman, SPICE_NAMES[c.spice], c.flip ? 'parallèle' : null, c.flat ? '♭ demi-ton' : null].filter(Boolean).join(' · ') : 'comptez un nombre sur vos doigts';
    label(ctx, info, b.x, b.y + big + 40, { size: 11, color: c ? INK : DIM });

    // Échelle des épices : la hauteur de la main enrichit l'accord.
    const ladderTop = b.y + big + 70;
    const cellH = portrait ? 22 : 34;
    const ladderW = 120;
    label(ctx, 'HAUTEUR · ÉPICES', b.x, ladderTop - 10, { size: 10 });
    for (let i = 0; i < 4; i++) {
      const y = ladderTop + (3 - i) * (cellH + 6);
      const on = c && c.spice === i;
      ctx.fillStyle = on ? INK : 'transparent';
      ctx.strokeStyle = on ? INK : FAINT;
      ctx.fillRect(b.x, y, ladderW, cellH);
      ctx.strokeRect(b.x + 0.5, y + 0.5, ladderW - 1, cellH - 1);
      label(ctx, SPICE_NAMES[i], b.x + 10, y + cellH / 2 + 4, { size: 10, color: on ? BG : DIM });
    }
    if (S.leftHeight !== null && S.leftHeight !== undefined) {
      const total = 4 * (cellH + 6) - 6;
      const y = ladderTop + total * (1 - S.leftHeight);
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(b.x + ladderW + 6, y);
      ctx.lineTo(b.x + ladderW + 22, y);
      ctx.stroke();
      ctx.lineWidth = 1;
    }
    const dialY = ladderTop + 4 * (cellH + 6) + 36;
    if (dialY < b.y + b.h + 40) dial(ctx, b.x + 22, dialY, 18, S.leftRoll, 'rotation · filtre');
  }

  drawRightPanel(ctx, b, S, portrait) {
    const mode = S.mode;
    label(ctx, `DROITE · ${mode ? ARC_NAMES[mode] : 'AUCUN MODE'}`, b.x, b.y);
    const st = S.modeState;
    let y = b.y + 22;
    if (!mode || !st) {
      label(ctx, 'poing, dos de la main vers la caméra', b.x, y + 10, { size: 11, color: INK });
      label(ctx, '→ l\'arc des modes apparaît', b.x, y + 30, { size: 11 });
      label(ctx, 'glissez · ouvrez la main pour choisir', b.x, y + 50, { size: 11 });
      return;
    }
    const f = S.pinchFinger;
    const rowH = portrait ? 22 : 30;
    if (mode === 'drums') {
      const cell = Math.min(16, (b.w - 4) / 16 - 2);
      DRUM_FAMILIES.forEach((fam, r) => {
        const ry = y + 14 + r * (rowH + 12);
        label(ctx, `${st.tracks[r]} · ${DRUM_LEVEL_NAMES[st.levels[r]]}`, b.x, ry, { size: 10, color: f === r ? ACCENT : DIM });
        const vel = drumBar(fam, st.levels[r], S.bar ?? 0);
        for (let s = 0; s < 16; s++) {
          const x = b.x + s * (cell + 2);
          const cy = ry + 6;
          ctx.strokeStyle = s === S.step ? INK : FAINT;
          ctx.strokeRect(x + 0.5, cy + 0.5, cell - 1, cell - 1);
          if (vel[s] > 0) {
            ctx.fillStyle = `rgba(236, 233, 226, ${0.25 + vel[s] * 0.7})`;
            ctx.fillRect(x + 2, cy + 2, cell - 4, cell - 4);
          }
        }
      });
      y += 4 * (rowH + 12) + 20;
    } else if (mode === 'melody') {
      const laneH = Math.max(10, Math.min(22, (b.h - 80) / MELODY_LANES));
      for (let l = MELODY_LANES - 1; l >= 0; l--) {
        const ly = y + (MELODY_LANES - 1 - l) * laneH;
        const active = st.lanes.findIndex((x) => x === l);
        ctx.strokeStyle = FAINT;
        ctx.beginPath();
        ctx.moveTo(b.x + 34, ly + laneH / 2);
        ctx.lineTo(b.x + b.w, ly + laneH / 2);
        ctx.stroke();
        label(ctx, laneLabel(st.key, l), b.x, ly + laneH / 2 + 4, { size: 9, color: active >= 0 ? ACCENT : DIM, spacing: 0.05 });
        if (active >= 0) {
          ctx.fillStyle = ACCENT;
          ctx.beginPath();
          ctx.arc(b.x + 50 + active * 40, ly + laneH / 2, 5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      if (S.rightHeight !== null && S.rightHeight !== undefined) {
        const hy = y + (1 - S.rightHeight) * MELODY_LANES * laneH;
        ctx.strokeStyle = DIM;
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.moveTo(b.x + 34, hy);
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
        label(ctx, name, b.x, ry, { size: 10, color: on ? ACCENT : DIM });
        ctx.strokeStyle = FAINT;
        ctx.strokeRect(b.x + 0.5, ry + 6.5, b.w - 1, 8);
        ctx.fillStyle = on ? ACCENT : INK;
        const v = mode === 'fx' && !st.active[r] ? 0 : values[r];
        ctx.fillRect(b.x + 1, ry + 7, (b.w - 2) * v, 7);
      });
      y += 4 * (rowH + 10) + 20;
    }
    label(ctx, f !== null && f !== undefined ? `pincé : ${PINCH_FINGERS[f]} · ${st.readout(f)}` : st.readout(null) || 'pincez pouce + doigt pour choisir une piste', b.x, y, { size: 10, color: f !== null && f !== undefined ? INK : DIM });
    if (y + 50 < b.y + b.h + 40) dial(ctx, b.x + 22, y + 40, 18, S.rightRoll, 'rotation');
  }

  drawHand(ctx, hand, vr, pinchFinger) {
    const P = hand.screen.map((p) => ({ x: vr.x + p.x * vr.w, y: vr.y + p.y * vr.h }));
    ctx.save();
    ctx.strokeStyle = 'rgba(236, 233, 226, 0.65)';
    ctx.lineWidth = 1.5;
    for (const [a, b] of CONNECTIONS) {
      ctx.beginPath();
      ctx.moveTo(P[a].x, P[a].y);
      ctx.lineTo(P[b].x, P[b].y);
      ctx.stroke();
    }
    ctx.fillStyle = INK;
    for (const p of P) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    if (pinchFinger !== null && pinchFinger !== undefined) {
      const tip = P[[LM.INDEX_TIP, LM.MIDDLE_TIP, LM.RING_TIP, LM.PINKY_TIP][pinchFinger]];
      const th = P[LM.THUMB_TIP];
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc((tip.x + th.x) / 2, (tip.y + th.y) / 2, 14, 0, Math.PI * 2);
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
    const span = Math.PI * 0.8 / n;
    ctx.save();
    for (let i = 0; i < n; i++) {
      const a0 = start + i * span + 0.02;
      const a1 = start + (i + 1) * span - 0.02;
      const on = arc.hover === i;
      ctx.beginPath();
      ctx.arc(x, y, R + 26, a0, a1);
      ctx.arc(x, y, R - 22, a1, a0, true);
      ctx.closePath();
      ctx.fillStyle = on ? 'rgba(236, 233, 226, 0.92)' : 'rgba(6, 7, 10, 0.55)';
      ctx.strokeStyle = on ? INK : DIM;
      ctx.fill();
      ctx.stroke();
      const am = (a0 + a1) / 2;
      label(ctx, ARC_NAMES[ARC_MODES[i]], x + Math.cos(am) * (R + 2), y + Math.sin(am) * (R + 2) + 4, {
        size: 10,
        align: 'center',
        color: on ? BG : INK,
        spacing: 0.12,
      });
    }
    label(ctx, 'ouvrir = choisir · dos = annuler', x, y + 26, { size: 9, align: 'center' });
    ctx.restore();
  }
}
