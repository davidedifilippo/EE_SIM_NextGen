import { describe, expect, it } from 'vitest';
import { Circuit } from '../model/types';
import { generateNetlist } from '../netlist/generate';
import { compileCircuit } from './compile';
import { blowTime, fuseSpec } from './fuse';
import { LiveSimulation } from './liveSimulation';
import { circuitFromNets, Part } from './testCircuits';

describe('the fuse against IEC 60127', () => {
  // The windows of the standard: quick-acting F and time-lag T, at 2.1, 2.75, 4 and 10 times the rated current
  const windows: [string, number, number, number][] = [
    ['F', 2.1, 0, 30 * 60],
    ['F', 2.75, 0.01, 2],
    ['F', 4, 0.001, 0.3],
    ['F', 10, 0, 0.02],
    ['T', 2.1, 0, 2 * 60],
    ['T', 2.75, 0.2, 10],
    ['T', 4, 0.15, 3],
    ['T', 10, 0.02, 0.15],
  ];
  it.each(windows)('%s at %s In blows between %s s and %s s', (type, times, low, high) => {
    const t = blowTime(fuseSpec('1', type)!, times);
    expect(t).toBeGreaterThan(low);
    expect(t).toBeLessThan(high);
  });

  it('never blows at its rated current, nor at 1.5 times it', () => {
    expect(blowTime(fuseSpec('1', 'F')!, 1)).toBe(Infinity);
    expect(blowTime(fuseSpec('1', 'F')!, 1.5)).toBe(Infinity);
  });
});

/** A supply, a fuse of 1 A and a load; the fuse is F unless said. */
const circuit = (volts: string, load: string, extra: Record<string, string> = {}, shape = 'dc'): Circuit =>
  circuitFromNets('t', [
    { def: 'vsource', tag: 'V1', nets: ['p', '0'], props: { shape, amplitude: volts, offset: '0', frequency: '50', phase: '0', duty: '50', rint: '0', spec: '' } },
    { def: 'fuse', tag: 'F1', nets: ['p', 'x'], props: { rating: '1', type: 'F', reset: '0', ...extra } },
    { def: 'resistor', tag: 'RL', nets: ['x', '0'], props: { value: load } },
  ] as Part[]);

const fuseIndex = (c: Circuit) => {
  const compiled = compileCircuit(c);
  if (!compiled.ok) throw new Error(compiled.errors.join());
  return compiled.compiled.elementIds.indexOf('f1');
};

/** Runs until the fuse blows, or the time is up; the time it blew, or null. */
function runUntilBlown(sim: LiveSimulation, index: number, seconds: number, h = 1e-4): number | null {
  for (let t = 0; t < seconds; t += 10 * h) {
    sim.advance(10, h, 1e6);
    if (sim.frame()!.fuses[index]?.isBlown) return t;
  }
  return null;
}

describe('the fuse in the animation', () => {
  it('turns red past its rating and blows when its time comes, then carries nothing', () => {
    // 12 V on 3 Ω: 4 A through a fuse of 1 A
    const c = circuit('12', '3');
    const index = fuseIndex(c);
    const sim = new LiveSimulation();
    expect(sim.load(c)).toEqual({ ok: true });
    // Red within a period of the mains, long before it blows
    sim.advance(200, 1e-4, 1e6);
    expect(sim.frame()!.fuses[index]).toMatchObject({ isOver: true, isBlown: false });
    // From the start: the 20 ms above, then until it blows
    const t = 0.02 + runUntilBlown(sim, index, 1)!;
    expect(t).toBeCloseTo(blowTime(fuseSpec('1', 'F')!, 4), 2);
    sim.advance(10, 1e-4, 1e6);
    expect(Math.abs(sim.frame()!.deviceCurrent[index])).toBeLessThan(1e-6);
  });

  it('carries 1.5 times its rating for good, without blowing', () => {
    const c = circuit('12', '8');
    const index = fuseIndex(c);
    const sim = new LiveSimulation();
    expect(sim.load(c)).toEqual({ ok: true });
    expect(runUntilBlown(sim, index, 5, 1e-3)).toBeNull();
    expect(sim.frame()!.fuses[index]!.isOver).toBe(true);
  });

  it('warms with the RMS current on alternating current', () => {
    // 230 V RMS on 100 Ω: 2.3 A RMS through a fuse of 1 A
    const c = circuit(String(230 * Math.SQRT2), '100', {}, 'sin');
    const index = fuseIndex(c);
    const sim = new LiveSimulation();
    expect(sim.load(c)).toEqual({ ok: true });
    const t = runUntilBlown(sim, index, 2)!;
    expect(t).toBeCloseTo(blowTime(fuseSpec('1', 'F')!, 2.3), 1);
  });

  it('stays blown as the circuit is loaded again, until it is put back in, cold', () => {
    const c = circuit('12', '3');
    const index = fuseIndex(c);
    const sim = new LiveSimulation();
    expect(sim.load(c)).toEqual({ ok: true });
    expect(runUntilBlown(sim, index, 1)).not.toBeNull();
    // The same circuit again, as a press of a button loads it
    expect(sim.load(c)).toEqual({ ok: true });
    sim.advance(10, 1e-4, 1e6);
    expect(sim.frame()!.fuses[index]!.isBlown).toBe(true);
    // Put back in, on a load of 2 A, which takes longer to blow it
    const replaced = circuit('12', '6', { reset: '1' });
    expect(sim.load(replaced)).toEqual({ ok: true });
    sim.advance(200, 1e-4, 1e6);
    expect(sim.frame()!.fuses[index]).toMatchObject({ isBlown: false, isOver: true });
    expect(Math.abs(sim.frame()!.deviceCurrent[index])).toBeCloseTo(2, 2);
  });

  it('goes to ngspice whole, as a small resistance', () => {
    const netlist = generateNetlist(circuit('12', '3'), { type: 'tran', step: '1u', stop: '10u' });
    expect(netlist.errors).toEqual([]);
    expect(netlist.text).toMatch(/^RF1 \S+ \S+ 0\.01$/m);
  });
});
