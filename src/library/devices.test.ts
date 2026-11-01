import { describe, expect, it } from 'vitest';
import { Circuit } from '../model/types';
import { createElement, getDevice, nextTag } from './devices';

const emptyCircuit = (): Circuit => ({ title: 't', elements: [], wires: [], models: [] });

describe('nextTag', () => {
  it('reuses the first free number, so deleting never creates duplicates', () => {
    const c = emptyCircuit();
    const r2 = createElement(getDevice('resistor')!, { x: 0, y: 0 }, 0, c, 'a');
    r2.tag = 'R2';
    expect(nextTag('R', [r2])).toBe('R1');
    r2.tag = 'r1';
    expect(nextTag('R', [r2])).toBe('R2');
  });
});

describe('createElement', () => {
  it('fills tag and default properties', () => {
    const el = createElement(getDevice('diode')!, { x: 10, y: 20 }, 90, emptyCircuit(), 'id1');
    expect(el).toEqual({ id: 'id1', def: 'diode', x: 10, y: 20, rot: 90, tag: 'D1', props: { model: 'D1N4148' } });
  });

  it('leaves ground without a tag', () => {
    expect(createElement(getDevice('ground')!, { x: 0, y: 0 }, 0, emptyCircuit(), 'g').tag).toBe('');
  });
});
