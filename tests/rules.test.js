import { describe, it, expect } from 'vitest';
import { classifyPose, fingerStates, openness } from '../src/core/rules.js';
import { synthHand, U, D, H } from './helpers/synthHand.js';

const label = (states, opts) => {
  const { world, image } = synthHand(states, opts);
  return classifyPose(world, image).label;
};

describe('états des doigts', () => {
  it('distingue tendu, à demi plié et replié', () => {
    const { world } = synthHand([U, U, H, D, U]);
    expect(fingerStates(world).states).toEqual(['up', 'up', 'half', 'down', 'up']);
  });
});

describe('poses statiques', () => {
  it('poing', () => expect(label([D, D, D, D, D])).toBe('fist'));
  it('1 doigt', () => expect(label([D, U, D, D, D])).toBe('one'));
  it('2 doigts serrés vs V écarté', () => {
    expect(label([D, U, U, D, D])).toBe('two');
    expect(label([D, U, U, D, D], { tilts: [0, -18, 18, 0, 0] })).toBe('peace');
  });
  it('3 et 4 doigts', () => {
    expect(label([D, U, U, U, D])).toBe('three');
    expect(label([D, U, U, U, U])).toBe('four');
  });
  it('paume serrée vs main ouverte', () => {
    expect(label([U, U, U, U, U])).toBe('palm');
    expect(label([U, U, U, U, U], { tilts: [0, -25, -8, 8, 25] })).toBe('open');
  });
  it('pouce levé / baissé selon l\'orientation', () => {
    expect(label([U, D, D, D, D], { rotateDeg: 53 })).toBe('like');
    expect(label([U, D, D, D, D], { rotateDeg: 233 })).toBe('dislike');
  });
  it('rock, appel, pistolet', () => {
    expect(label([D, U, D, D, U])).toBe('rock');
    expect(label([U, D, D, D, U])).toBe('call');
    expect(label([U, U, D, D, D])).toBe('gun');
  });
  it('OK : pouce et index qui se touchent, autres doigts levés', () => {
    const base = synthHand([D, H, U, U, U]);
    const tip = base.world[8];
    expect(label([D, H, U, U, U], { overrides: { 4: { x: tip.x - 0.005, y: tip.y, z: tip.z } } })).toBe('ok');
  });
  it('griffe : doigts à demi pliés', () => expect(label([D, H, H, H, H])).toBe('claw'));
  it('compte les doigts levés', () => {
    const { world, image } = synthHand([U, U, U, D, D]);
    expect(classifyPose(world, image).count).toBe(3);
  });
});

describe('ouverture', () => {
  it('main ouverte plus grande que le poing', () => {
    expect(openness(synthHand([U, U, U, U, U]).world)).toBeGreaterThan(openness(synthHand([D, D, D, D, D]).world));
  });
});
