// Tutoriel « comment jouer » : un panneau à droite avec des mains animées pour chaque geste.
// Chaque leçon se valide toute seule quand le joueur réussit le geste devant la caméra.

import { POSES, blendPose, drawPuppet } from './puppet.js';
import * as Palette from '../core/palette.js';

const P = POSES;
const back = (pose) => ({ ...pose, back: true });
const L = (pose, x = 0.3, y = 0.6) => ({ pose, x, y });
const R = (pose, x = 0.7, y = 0.6) => ({ pose, x, y });

/** Les compteurs (app.stats) sont comparés à leur valeur au début de la leçon. */
export const LESSONS = [
  {
    title: 'jouer un accord',
    text: 'Main gauche : lève un doigt. L\'accord sonne tant que tu gardes la pose.',
    frames: [
      { at: 0, left: L(P.fist) },
      { at: 0.3, left: L(P.one) },
      { at: 1, left: L(P.one) },
    ],
    check: (s, b) => s.chordsPlayed > b.chordsPlayed,
  },
  {
    title: 'changer d\'accord',
    text: 'Compte 1, 2, 3, 4 doigts : chaque nombre est un accord de la tonalité. Main ouverte = V, cornes = VI.',
    frames: [
      { at: 0, left: L(P.one) },
      { at: 0.25, left: L(P.two) },
      { at: 0.5, left: L(P.three) },
      { at: 0.75, left: L(P.four) },
      { at: 1, left: L(P.one) },
    ],
    check: (s, b) => s.chordNames.size - b.chordNamesSize >= 3,
  },
  {
    title: 'enrichir l\'accord',
    text: 'Garde la pose et monte la main : la triade devient une 7e, une 9e, puis une 13e.',
    arrow: { x: 0.12, from: 0.8, to: 0.25 },
    frames: [
      { at: 0, left: L(P.one, 0.3, 0.8) },
      { at: 0.6, left: L(P.one, 0.3, 0.3) },
      { at: 1, left: L(P.one, 0.3, 0.8) },
    ],
    check: (s, b) => s.richChords > b.richChords,
  },
  {
    title: 'changer d\'instrument',
    text: 'Main gauche : tiens le poing une demi-seconde, la roue apparaît. Tourne le poignet pour choisir, puis ouvre la main pour valider.',
    frames: [
      { at: 0, left: L(P.palm) },
      { at: 0.15, left: L(P.fist) },
      { at: 0.35, left: L({ ...P.fist, rot: -30 }) },
      { at: 0.6, left: L({ ...P.fist, rot: 30 }) },
      { at: 0.8, left: L({ ...P.palm, rot: 30 }) },
      { at: 1, left: L(P.palm) },
    ],
    check: (s, b) => s.instrumentChanges > b.instrumentChanges,
  },
  {
    title: 'jouer la mélodie',
    text: 'Main droite : pince le pouce et l\'index (garde les autres doigts levés). La hauteur de la main choisit la note.',
    arrow: { x: 0.9, from: 0.8, to: 0.3 },
    frames: [
      { at: 0, right: R(P.palm, 0.7, 0.75) },
      { at: 0.2, right: R(P.pinchIndex, 0.7, 0.75) },
      { at: 0.6, right: R(P.pinchIndex, 0.7, 0.3) },
      { at: 0.85, right: R(P.pinchIndex, 0.7, 0.75) },
      { at: 1, right: R(P.palm, 0.7, 0.75) },
    ],
    check: (s, b) => s.melodyNotes - b.melodyNotes >= 3,
  },
  {
    title: 'choisir un mode',
    text: 'Main droite : poing, dos de la main vers la caméra. L\'arc apparaît : glisse, puis ouvre la main paume vers la caméra.',
    arrow: { y: 0.3, from: 0.55, to: 0.8, horizontal: true },
    frames: [
      { at: 0, right: R(P.palm, 0.55, 0.6) },
      { at: 0.2, right: R(back(P.fist), 0.55, 0.6) },
      { at: 0.55, right: R(back(P.fist), 0.8, 0.6) },
      { at: 0.75, right: R(P.open, 0.8, 0.6) },
      { at: 1, right: R(P.open, 0.8, 0.6) },
    ],
    check: (s, b) => s.arcSelections > b.arcSelections,
  },
  {
    title: 'lancer la batterie',
    text: 'En mode batterie (touche 1 ou arc) : pince pouce + index et tourne le poignet. Lâche : le rythme continue.',
    frames: [
      { at: 0, right: R({ ...P.pinchIndex, rot: -35 }) },
      { at: 0.5, right: R({ ...P.pinchIndex, rot: 35 }) },
      { at: 1, right: R({ ...P.pinchIndex, rot: -35 }) },
    ],
    check: (s, b) => s.drumChanges > b.drumChanges,
  },
  {
    title: 'silence',
    text: 'Serre bien les deux poings : tout se tait. Garde-les fermés plus d\'une seconde pour tout arrêter.',
    frames: [
      { at: 0, left: L(P.open), right: R(P.open) },
      { at: 0.35, left: L(P.fist), right: R(P.fist) },
      { at: 1, left: L(P.fist), right: R(P.fist) },
    ],
    check: (s, b) => s.mutes > b.mutes,
  },
];

/** Position et pose d'une main au temps t (0..1) d'une leçon. */
export function sampleLesson(lesson, side, t) {
  const frames = lesson.frames.filter((f) => f[side]);
  if (!frames.length) return null;
  let i = 0;
  while (i < frames.length - 1 && frames[i + 1].at <= t) i++;
  const a = frames[i];
  const b = frames[Math.min(i + 1, frames.length - 1)];
  const span = Math.max(b.at - a.at, 1e-6);
  const k = a === b ? 0 : Math.min(1, Math.max(0, (t - a.at) / span));
  const e = k * k * (3 - 2 * k); // easing
  return {
    pose: blendPose(a[side].pose, b[side].pose, e),
    x: a[side].x + (b[side].x - a[side].x) * e,
    y: a[side].y + (b[side].y - a[side].y) * e,
  };
}

export class Tutorial {
  constructor(app, els) {
    this.app = app;
    this.els = els; // {panel, canvas, step, title, text, status, prev, next}
    this.ctx = els.canvas.getContext('2d');
    this.index = 0;
    this.done = new Set();
    this.base = null;
    this.successAt = null;
    els.prev.addEventListener('click', () => this.go(this.index - 1));
    els.next.addEventListener('click', () => this.go(this.index + 1));
    this.go(0);
  }

  get open() {
    return !this.els.panel.hidden;
  }

  snapshot() {
    const s = this.app.stats;
    return { ...s, chordNamesSize: s.chordNames.size, chordNames: undefined };
  }

  go(i) {
    this.index = Math.max(0, Math.min(LESSONS.length - 1, i));
    this.base = this.snapshot();
    this.app.stats.chordNames = new Set();
    this.base.chordNamesSize = 0;
    this.successAt = null;
    const lesson = LESSONS[this.index];
    this.els.step.textContent = `${this.index + 1} / ${LESSONS.length}`;
    this.els.title.textContent = lesson.title;
    this.els.text.textContent = lesson.text;
    this.els.status.textContent = this.done.has(this.index) ? 'déjà réussi · essaie encore' : 'à toi : essaie devant la caméra';
    this.els.status.className = 'tutor-status';
    this.els.prev.disabled = this.index === 0;
    this.els.next.textContent = this.index === LESSONS.length - 1 ? 'terminé' : 'suivant →';
  }

  /** Appelé à chaque image de rendu. */
  tick(now) {
    if (!this.open) return;
    const lesson = LESSONS[this.index];
    if (this.successAt === null && this.app.started && lesson.check(this.app.stats, this.base)) {
      this.successAt = now;
      this.done.add(this.index);
      this.els.status.textContent = 'réussi !';
      this.els.status.className = 'tutor-status ok';
    }
    if (this.successAt !== null && now - this.successAt > 1600 && this.index < LESSONS.length - 1) this.go(this.index + 1);
    this.draw(now);
  }

  draw(now) {
    const c = this.els.canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (c.width !== Math.round(w * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const lesson = LESSONS[this.index];
    const t = (now % 3200) / 3200;
    if (lesson.arrow) this.drawArrow(ctx, lesson.arrow, w, h);
    const size = Math.min(w, h) * (lesson.frames.some((f) => f.left) && lesson.frames.some((f) => f.right) ? 0.27 : 0.36);
    for (const side of ['left', 'right']) {
      const s = sampleLesson(lesson, side, t);
      if (!s) continue;
      // y de la leçon = position du poignet entre « main tout en haut » et le bas du cadre.
      const wy = size * 1.75 + s.y * (h - 30 - size * 1.75);
      const wx = Math.max(size * 0.8, Math.min(w - size * 0.8, s.x * w));
      drawPuppet(ctx, wx, wy, size, s.pose, side, { ink: side === 'left' ? Palette.LEFT_RGB : Palette.RIGHT_RGB, accent: Palette.ACCENT });
      ctx.font = `500 12px ${Palette.SANS}`;
      ctx.fillStyle = Palette.DIM;
      ctx.textAlign = 'center';
      ctx.fillText(side === 'left' ? 'main gauche' : 'main droite', wx, h - 10);
    }
  }

  drawArrow(ctx, a, w, h) {
    ctx.save();
    ctx.strokeStyle = `${Palette.ACCENT}b3`;
    ctx.fillStyle = `${Palette.ACCENT}b3`;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    const [x1, y1, x2, y2] = a.horizontal ? [a.from * w, a.y * h, a.to * w, a.y * h] : [a.x * w, a.from * h, a.x * w, a.to * h];
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.setLineDash([]);
    const ang = Math.atan2(y2 - y1, x2 - x1);
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - 9 * Math.cos(ang - 0.4), y2 - 9 * Math.sin(ang - 0.4));
    ctx.lineTo(x2 - 9 * Math.cos(ang + 0.4), y2 - 9 * Math.sin(ang + 0.4));
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}
