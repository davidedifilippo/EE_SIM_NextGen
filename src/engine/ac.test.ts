import { describe, expect, it } from 'vitest';
import { terminalKey } from '../netlist/connectivity';
import { AcAnalysis, generateNetlist } from '../netlist/generate';
import { circuitFromNets, Part } from '../realtime/testCircuits';
import { bodeCurve, bodeSummary } from '../ui/bode';
import { runAc } from './ngspice';

const V = (tag: string, a: string, b: string, spec: string): Part => ({ def: 'vsource', tag, nets: [a, b], props: { spec } });
const R = (tag: string, a: string, b: string, value: string): Part => ({ def: 'resistor', tag, nets: [a, b], props: { value } });
const C = (tag: string, a: string, b: string, value: string): Part => ({ def: 'capacitor', tag, nets: [a, b], props: { value } });
const L = (tag: string, a: string, b: string, value: string): Part => ({ def: 'inductor', tag, nets: [a, b], props: { value } });
const SINE: Part['props'] = { shape: 'sin', amplitude: '5', offset: '0', frequency: '50', phase: '0', spec: '' };
const SIGNAL: Part = { def: 'vsource', tag: 'V1', nets: ['in', '0'], props: SINE };
const opAmp = (minus: string, plus: string, out: string, gbw = ''): Part => ({ def: 'opamp', tag: 'U1', nets: [minus, plus, out], props: { high: '15', low: '-15', gbw } });
const nonInverting = (gain: number, gbw: string): Part[] => [SIGNAL, R('R1', 'n', '0', '100'), R('R2', 'n', 'out', String(100 * (gain - 1))), opAmp('n', 'in', 'out', gbw)];

const ANALYSIS: AcAnalysis = { type: 'ac', from: '1', to: '1meg', pointsPerDecade: 100 };

/** The curve at the node of a terminal, with the frequency of the sweep. */
async function sweep(parts: Part[], element: string, terminal: string, analysis = ANALYSIS) {
  const circuit = circuitFromNets('t', parts);
  const netlist = generateNetlist(circuit, analysis);
  expect(netlist.errors).toEqual([]);
  const result = await runAc(netlist.text);
  const v = result.voltages.get(netlist.nodeOf.get(terminalKey(element, terminal))!)!;
  const curve = bodeCurve(v.re, v.im);
  const at = (f: number) => {
    let best = 0;
    result.frequency.forEach((x, i) => {
      if (Math.abs(Math.log(x / f)) < Math.abs(Math.log(result.frequency[best] / f))) best = i;
    });
    return { gain: curve.gain[best], phase: curve.phase[best] };
  };
  return { ...curve, frequency: result.frequency, at, summary: bodeSummary(result.frequency, curve.gain) };
}

describe('AC analysis against the formulas', () => {
  it('low pass RC: cutoff at 1/(2 pi R C), -20 dB per decade, -45 degrees at the cutoff', async () => {
    const s = await sweep([SIGNAL, R('R1', 'in', 'out', '1k'), C('C1', 'out', '0', '1u')], 'c1', 'a');
    const fc = 1 / (2 * Math.PI * 1e3 * 1e-6);
    expect(s.summary.upper!).toBeCloseTo(fc, 0);
    expect(s.summary.lower).toBeNull();
    expect(s.at(fc).phase).toBeCloseTo(-45, 0);
    expect(s.at(1).gain).toBeCloseTo(0, 2);
    expect(s.at(1e5).gain - s.at(1e4).gain).toBeCloseTo(-20, 1);
  });

  it('high pass RC', async () => {
    const s = await sweep([SIGNAL, C('C1', 'in', 'out', '100n'), R('R1', 'out', '0', '10k')], 'r1', 'a');
    expect(s.summary.lower!).toBeCloseTo(1 / (2 * Math.PI * 1e4 * 1e-7), 0);
    expect(s.summary.upper).toBeNull();
    expect(s.at(1).phase).toBeCloseTo(90, 0);
  });

  it('series RLC: resonance at 1/(2 pi sqrt(LC)), bandwidth R/(2 pi L)', async () => {
    const s = await sweep([SIGNAL, L('L1', 'in', 'a', '10m'), C('C1', 'a', 'out', '1u'), R('R1', 'out', '0', '20')], 'r1', 'a');
    expect(s.summary.peakFrequency / (1 / (2 * Math.PI * Math.sqrt(1e-8)))).toBeCloseTo(1, 1);
    // The sweep does not fall exactly on the resonance, so the peak is a little short of 0 dB
    expect(s.summary.peak).toBeCloseTo(0, 1);
    expect(s.summary.upper! - s.summary.lower!).toBeCloseTo(20 / (2 * Math.PI * 1e-2), -1);
  });

  it('a phase through two poles goes down to -180 degrees without jumps', async () => {
    const s = await sweep([SIGNAL, L('L1', 'in', 'out', '10m'), C('C1', 'out', '0', '1u'), R('R1', 'out', '0', '100')], 'c1', 'a');
    expect(s.at(1e6).phase).toBeCloseTo(-180, -1);
    s.phase.slice(1).forEach((p, i) => expect(Math.abs(p - s.phase[i])).toBeLessThan(90));
  });

  it('inverting op amp: gain -R2/R1 means 20 dB and 180 degrees', async () => {
    const s = await sweep([SIGNAL, R('R1', 'in', 'n', '1k'), R('R2', 'n', 'out', '10k'), opAmp('n', '0', 'out')], 'r2', 'b');
    expect(s.at(1000).gain).toBeCloseTo(20, 2);
    expect(Math.abs(s.at(1000).phase)).toBeCloseTo(180, 1);
  });

  it('active low pass with an op amp: gain from the resistors, cutoff from R2 and C', async () => {
    const s = await sweep([SIGNAL, R('R1', 'in', 'n', '1k'), R('R2', 'n', 'out', '10k'), C('C1', 'n', 'out', '10n'), opAmp('n', '0', 'out')], 'r2', 'b', { type: 'ac', from: '10', to: '100k', pointsPerDecade: 100 });
    expect(s.summary.peak).toBeCloseTo(20, 2);
    expect(s.summary.upper!).toBeCloseTo(1 / (2 * Math.PI * 1e4 * 1e-8), -1);
  });

  it('bandwidth: gain 1000 and GBW 1 MHz give 60 dB up to 1 kHz', async () => {
    const s = await sweep(nonInverting(1000, '1meg'), 'r2', 'b');
    expect(s.summary.peak).toBeCloseTo(60, 1);
    expect(s.summary.upper! / 1000).toBeCloseTo(1, 1);
    expect(s.at(1000).phase).toBeCloseTo(-45, -1);
    expect(s.at(1e5).gain).toBeCloseTo(20, 0);
  });

  it('the same op amp has 10 kHz at gain 100, and a follower its whole GBW', async () => {
    expect((await sweep(nonInverting(100, '1meg'), 'r2', 'b')).summary.upper! / 1e4).toBeCloseTo(1, 1);
    const follower: Part[] = [SIGNAL, opAmp('out', 'in', 'out', '1meg'), R('RL', 'out', '0', '10k')];
    const s = await sweep(follower, 'rl', 'a', { type: 'ac', from: '1k', to: '100meg', pointsPerDecade: 100 });
    expect(s.summary.upper! / 1e6).toBeCloseTo(1, 1);
  });

  it('without GBW, it stays flat where the real part would have fallen', async () => {
    const s = await sweep(nonInverting(1000, ''), 'r2', 'b');
    expect(s.at(1e5).gain).toBeCloseTo(60, 1);
  });

  it('a transformer: the ratio in band, a cutoff below it from its inductance and the source resistance', async () => {
    const parts: Part[] = [SIGNAL, R('R1', 'in', 'p', '100'), { def: 'transformer', tag: 'T1', nets: ['p', '0', 'out', '0'], props: { ratio: '10', inductance: '1', coupling: '0.999' } }, R('RL', 'out', '0', '1meg')];
    const s = await sweep(parts, 'rl', 'a', { type: 'ac', from: '0.1', to: '1meg', pointsPerDecade: 50 });
    expect(s.at(10000).gain).toBeCloseTo(-20, 0);
    expect(s.summary.lower! / (100 / (2 * Math.PI * 1))).toBeCloseTo(1, 0);
  });

  it('a transistor amplifies around its DC bias, taken from the offsets and DC sources', async () => {
    const parts: Part[] = [
      V('VCC', 'vcc', '0', 'DC 12'),
      SIGNAL,
      C('C1', 'in', 'b', '10u'),
      R('R1', 'vcc', 'b', '47k'),
      R('R2', 'b', '0', '10k'),
      R('RC', 'vcc', 'c', '2.2k'),
      R('RE', 'e', '0', '470'),
      { def: 'npn', tag: 'Q1', nets: ['c', 'b', 'e'], props: { model: '2N3904' } },
    ];
    const s = await sweep(parts, 'rc', 'b', { type: 'ac', from: '10', to: '100k', pointsPerDecade: 50 });
    // With the emitter resistor, close to RC/RE = 4.7, that is 13.4 dB, and a bit less
    expect(s.at(1000).gain).toBeGreaterThan(12.5);
    expect(s.at(1000).gain).toBeLessThan(13.5);
    expect(Math.abs(s.at(1000).phase)).toBeCloseTo(180, -1);
  });

  it('does not count on the amplitude of the generator: the result is a transfer function', async () => {
    const s = await sweep([{ ...SIGNAL, props: { ...SINE, amplitude: '325' } }, R('R1', 'in', 'out', '1k'), R('R2', 'out', '0', '1k')], 'r2', 'a');
    expect(s.at(100).gain).toBeCloseTo(-6.02, 1);
  });
});
