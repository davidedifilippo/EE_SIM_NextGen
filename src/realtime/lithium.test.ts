import { describe, expect, it } from 'vitest';
import { Circuit } from '../model/types';
import { generateNetlist } from '../netlist/generate';
import { compileCircuit } from './compile';
import { RealtimeEngine } from './engine';
import { cellVoltage, lithiumSpec, nextCharge, packResistance, packVoltage } from './lithium';
import { LiveSimulation } from './liveSimulation';
import { circuitFromNets } from './testCircuits';

describe('the lithium pack', () => {
  it('3S: 12.6 V full, 11.4 V half, 9 V empty', () => {
    const spec = lithiumSpec('3', '2', 'real')!;
    expect(packVoltage(spec, 1)).toBeCloseTo(12.6, 6);
    expect(packVoltage(spec, 0.5)).toBeCloseTo(11.4, 6);
    expect(packVoltage(spec, 0)).toBeCloseTo(9, 6);
    expect(cellVoltage(0.95)).toBeCloseTo(4.14, 6);
  });

  it('3S of 2 Ah: 75 mΩ inside', () => {
    expect(packResistance(lithiumSpec('3', '2', 'real')!)).toBeCloseTo(0.075, 6);
    expect(packResistance(lithiumSpec('1', '10', 'real')!)).toBeCloseTo(0.005, 6);
  });

  it('refuses what it cannot be', () => {
    expect(lithiumSpec('6', '2', 'real')).toBeNull();
    expect(lithiumSpec('3', '12', 'real')).toBeNull();
  });
});

/** A pack on a resistor; the charge read from the engine. */
const packOn = (load: string, props: Record<string, string> = {}): Circuit =>
  circuitFromNets('t', [
    { def: 'lithium', tag: 'B1', nets: ['p', '0'], props: { cells: '1', capacity: '1', pace: 'real', recharge: '0', ...props } },
    { def: 'resistor', tag: 'RL', nets: ['p', '0'], props: { value: load } },
  ]);

const engineOf = (c: Circuit) => {
  const compiled = compileCircuit(c);
  if (!compiled.ok) throw new Error(compiled.errors.join());
  const engine = new RealtimeEngine(compiled.compiled);
  engine.initialize();
  return { engine, b: compiled.compiled.elementIds.indexOf('b1') };
};

describe('the pack running down', () => {
  it('at the pace of the simulation, 2 A for 36 s take 2% of 1 Ah', () => {
    // About 2.1 A at first on 2 Ω, a little less as the voltage falls
    const { engine, b } = engineOf(packOn('2'));
    const current = Math.abs(engine.deviceCurrent(b));
    for (let t = 0; t < 36; t += 0.01) engine.step(0.01);
    const used = 1 - engine.batteryStatus(b)!.charge;
    expect(used).toBeCloseTo((current * 36) / 3600, 3);
  });

  it('an hour a second: with the simulation at 20 ms a second, a second of battery is 180000 of simulation', () => {
    const { engine, b } = engineOf(packOn('4.2', { pace: '3600' }));
    engine.simPerReal = 0.02;
    // 1 A for 1 ms of simulation: 180 s of battery, 1/20 of 1 Ah
    for (let k = 0; k < 10; k++) engine.step(1e-4);
    expect(1 - engine.batteryStatus(b)!.charge).toBeCloseTo(0.05, 2);
  });

  it('opens as empty and gives nothing more; a charge again brings it back full', () => {
    const c = packOn('4.2', { pace: '3600' });
    const sim = new LiveSimulation();
    expect(sim.load(c)).toEqual({ ok: true });
    const { b } = engineOf(c);
    let k = 0;
    // At 0.24 s of simulation a second, 1 Ah at 1 A lasts 1 s of real time: 2400 steps of 1e-4
    for (; k < 100 && !sim.frame()!.batteries[b]!.isCut; k++) sim.advance(100, 1e-4, 1e6);
    expect(sim.frame()!.batteries[b]).toMatchObject({ isCut: true, charge: 0 });
    expect(k).toBeGreaterThan(20);
    expect(k).toBeLessThan(30);
    sim.advance(10, 1e-4, 1e6);
    expect(Math.abs(sim.frame()!.deviceCurrent[b])).toBeLessThan(1e-6);
    // Loaded again without charging: still empty
    expect(sim.load(c)).toEqual({ ok: true });
    sim.advance(10, 1e-4, 1e6);
    expect(sim.frame()!.batteries[b]!.isCut).toBe(true);
    // Charged again
    expect(sim.load(packOn('4.2', { pace: '3600', recharge: '1' }))).toEqual({ ok: true });
    sim.advance(10, 1e-4, 1e6);
    expect(sim.frame()!.batteries[b]!.isCut).toBe(false);
    expect(sim.frame()!.batteries[b]!.charge).toBeGreaterThan(0.99);
  });

  it('charges with a current into it, up to full', () => {
    const spec = lithiumSpec('1', '1', 'real')!;
    // 1 A into it for 36 s: 1% more; never past full
    expect(nextCharge(spec, 0.5, -1, 36, 1)).toBeCloseTo(0.51, 6);
    expect(nextCharge(spec, 0.999, -1, 36, 1)).toBe(1);
  });

  it('goes to ngspice full, behind its resistance', () => {
    const netlist = generateNetlist(packOn('10', { cells: '3', capacity: '2' }), { type: 'tran', step: '1u', stop: '10u' });
    expect(netlist.errors).toEqual([]);
    expect(netlist.text).toMatch(/^VB1 \S+ \S+ DC 12\.6$/m);
    expect(netlist.text).toMatch(/^RIVB1 \S+ \S+ 0\.075$/m);
  });
});
