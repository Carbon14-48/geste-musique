import { describe, it, expect } from 'vitest';
import { GestureStabilizer, Hysteresis, ComboDetector, Cooldown } from '../src/core/trigger.js';

const feed = (stab, labels, t0 = 0, dt = 33) => labels.flatMap((l, i) => stab.update(l, t0 + i * dt));

describe('GestureStabilizer', () => {
  it('n\'entre qu\'après plusieurs images identiques', () => {
    const s = new GestureStabilizer({ enterFrames: 3 });
    expect(feed(s, ['fist', 'fist'])).toEqual([]);
    expect(s.update('fist', 100).map((e) => e.type)).toEqual(['enter']);
  });

  it('ignore une image parasite isolée', () => {
    const s = new GestureStabilizer({ enterFrames: 3, holdMs: 1e9 });
    feed(s, ['one', 'one', 'one']);
    expect(feed(s, ['two', 'one', 'one'], 200)).toEqual([]);
    expect(s.current).toBe('one');
  });

  it('émet exit puis enter lors d\'un changement', () => {
    const s = new GestureStabilizer({ enterFrames: 2, holdMs: 1e9 });
    feed(s, ['one', 'one']);
    expect(feed(s, ['two', 'two'], 100).map((e) => `${e.type}:${e.label}`)).toEqual(['exit:one', 'enter:two']);
  });

  it('émet hold une seule fois après le délai', () => {
    const s = new GestureStabilizer({ enterFrames: 1, holdMs: 500 });
    const events = feed(s, Array(30).fill('ok'));
    expect(events.filter((e) => e.type === 'hold')).toHaveLength(1);
  });

  it('détecte un double geste rapide', () => {
    const s = new GestureStabilizer({ enterFrames: 1, exitFrames: 1, doubleMs: 600, holdMs: 1e9 });
    const events = [...s.update('gun', 0), ...s.update('none', 100), ...s.update('gun', 300)];
    expect(events.some((e) => e.type === 'double' && e.label === 'gun')).toBe(true);
  });
});

describe('Hysteresis', () => {
  it('utilise deux seuils', () => {
    const h = new Hysteresis(0.6, 0.4);
    expect([0.5, 0.65, 0.5, 0.45, 0.3].map((v) => h.update(v))).toEqual([false, true, true, true, false]);
  });
});

describe('ComboDetector', () => {
  it('reconnaît la séquence dans l\'ordre et dans le temps', () => {
    const c = new ComboDetector(['fist', 'open', 'two'], { stepMs: 1000 });
    expect(c.push('fist', 0)).toBe(false);
    expect(c.push('open', 300)).toBe(false);
    expect(c.push('two', 600)).toBe(true);
  });

  it('abandonne si une étape est trop lente', () => {
    const c = new ComboDetector(['fist', 'open', 'two'], { stepMs: 500 });
    c.push('fist', 0);
    c.push('open', 300);
    expect(c.push('two', 2000)).toBe(false);
  });
});

describe('Cooldown', () => {
  it('limite la fréquence', () => {
    const c = new Cooldown(100);
    expect([0, 50, 120].map((t) => c.ready(t))).toEqual([true, false, true]);
  });
});
