// Mode thérémine : la hauteur de la main droite règle la note en continu,
// la hauteur de la main gauche règle le volume. Option « aimanter » sur la gamme.

import { quantize, midiToName } from '../core/scale.js';

export default {
  id: 'theremin',
  name: 'Thérémine',
  overrides: ['like', 'dislike'],
  help: [
    ['Hauteur de la main droite', 'Hauteur de la note (2 octaves et demie)'],
    ['Hauteur de la main gauche', 'Volume (sans main gauche : volume fixe)'],
    ['Poing (une main)', 'Silence'],
    ['Écart pouce-index (droite)', 'Brillance du son'],
    ['Option « aimanter »', 'Les notes collent à la gamme choisie'],
  ],
  enter() {},
  exit(app) {
    app.engine.thereminOff();
  },
  frame(app, frame) {
    const { engine, settings } = app;
    const { left, right } = frame.hands;
    if (!right || right.label === 'fist' || left?.label === 'fist') {
      engine.thereminOff();
      app.hud('note', '—');
      return;
    }
    const h = app.normHeight(right.height);
    let midi = settings.root - 12 + h * 30;
    if (settings.snap) midi = quantize(midi, settings.root, settings.scale);
    const level = left ? Math.max(0, Math.min(1, (app.normHeight(left.height) - 0.1) / 0.8)) : 0.7;
    engine.thereminSet(midi, level);
    engine.setBrightness(Math.min(1, 0.3 + right.pinch / 1.5));
    app.hud('note', `${midiToName(midi)} · vol ${Math.round(level * 100)} %`);
  },
  draw(ctx, w, h) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '12px system-ui';
    for (let i = 0; i <= 5; i++) {
      const y = h * (1 - i / 5);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    ctx.fillText('aigu ↑', 8, 18);
    ctx.fillText('grave ↓', 8, h - 8);
    ctx.restore();
  },
};
