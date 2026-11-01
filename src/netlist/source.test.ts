import { describe, expect, it } from 'vitest';
import { waveformStats } from '../realtime/waveform';
import { sourceLabel, sourceShape, sourceSpec } from './source';

const sine = { shape: 'sin', amplitude: '10', offset: '0', frequency: '50', phase: '0', spec: '' };

describe('sourceSpec', () => {
  it('writes a plain sine without the trailing parameters', () => {
    expect(sourceSpec(sine)).toBe('SIN(0 10 50)');
  });

  it('adds offset and phase to a sine', () => {
    expect(sourceSpec({ ...sine, offset: '2', phase: '30' })).toBe('SIN(2 10 50 0 0 30)');
  });

  it('reads SPICE suffixes', () => {
    expect(sourceSpec({ ...sine, amplitude: '500m', frequency: '1k' })).toBe('SIN(0 0.5 1000)');
  });

  it('counts empty offset and phase as 0', () => {
    expect(sourceSpec({ ...sine, offset: '', phase: ' ' })).toBe('SIN(0 10 50)');
  });

  it('writes a square wave around the offset, without rounding the frequency', () => {
    const stats = waveformStats(sourceSpec({ ...sine, shape: 'square', amplitude: '5', offset: '1', frequency: '47' })!)!;
    expect(stats.max).toBe(6);
    expect(stats.min).toBe(-4);
    expect(stats.frequency).toBeCloseTo(47, 9);
    expect(stats.rms).toBeCloseTo(Math.sqrt(26), 2);
  });

  it('uses only the voltage for DC', () => {
    expect(sourceSpec({ ...sine, shape: 'dc', amplitude: '12', frequency: 'x' })).toBe('DC 12');
  });

  it('keeps the text of an advanced source', () => {
    expect(sourceSpec({ ...sine, shape: 'custom', spec: ' PWL(0 0 1m 5) ' })).toBe('PWL(0 0 1m 5)');
  });

  it('treats a spec without a shape as an advanced source', () => {
    expect(sourceShape({ spec: 'DC 5' })).toBe('custom');
    expect(sourceSpec({ spec: 'DC 5' })).toBe('DC 5');
  });

  it.each([
    ['maximum', { amplitude: 'abc' }],
    ['empty maximum', { amplitude: '' }],
    ['offset', { offset: 'abc' }],
    ['frequency', { frequency: 'abc' }],
    ['zero frequency', { frequency: '0' }],
    ['negative frequency', { frequency: '-50' }],
    ['phase', { phase: 'abc' }],
    ['empty advanced text', { shape: 'custom', spec: ' ' }],
    ['advanced text on two lines', { shape: 'custom', spec: 'DC 1\n.control' }],
  ])('rejects an invalid %s', (_, change) => {
    expect(sourceSpec({ ...sine, ...change })).toBeNull();
  });
});

describe('sourceLabel', () => {
  it('shows maximum and frequency, not the offset', () => {
    expect(sourceLabel({ ...sine, amplitude: '325', offset: '5' })).toBe('325 V · 50 Hz');
    expect(sourceLabel({ ...sine, shape: 'square', amplitude: '500m', frequency: '1k' })).toBe('500 mV · 1 kHz');
  });

  it('shows only the voltage for DC', () => {
    expect(sourceLabel({ ...sine, shape: 'dc', amplitude: '5' })).toBe('5 V');
  });

  it('shows the string only for an advanced source', () => {
    expect(sourceLabel({ ...sine, shape: 'custom', spec: 'SIN(0 5 50 0 10)' })).toBe('SIN(0 5 50 0 10)');
  });

  it('marks what is not valid', () => {
    expect(sourceLabel({ ...sine, frequency: '' })).toBe('?');
    expect(sourceLabel({ ...sine, shape: 'custom', spec: '' })).toBe('?');
  });
});
