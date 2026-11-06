import { describe, expect, it } from 'vitest';
import { runTransient } from '../engine/ngspice';
import { terminalKey } from '../netlist/connectivity';
import { generateNetlist } from '../netlist/generate';
import { compileCircuit } from './compile';
import { RealtimeEngine } from './engine';
import { LiveSimulation } from './liveSimulation';
import { filamentResistance, lampBrightness, lampParams } from './lamp';
import { circuitFromNets, Part } from './testCircuits';

const supply = (volts: string): Part => ({ def: 'vsource', tag: 'V1', nets: ['p', '0'], props: { shape: 'dc', amplitude: volts, offset: '0', frequency: '50', phase: '0', duty: '50', spec: '' } });
const lamp = (power: string, volts: string): Part => ({ def: 'lamp', tag: 'LP1', nets: ['p', '0'], props: { power, volts } });

describe('the lamp', () => {
  it('takes its rated power at its rated voltage, in both engines', async () => {
    const parts = [supply('48'), lamp('10', '48')];
    const compiled = compileCircuit(circuitFromNets('t', parts));
    if (!compiled.ok) throw new Error(compiled.errors.join());
    const engine = new RealtimeEngine(compiled.compiled);
    engine.initialize();
    const current = engine.deviceCurrent(compiled.compiled.elementIds.indexOf('lp1'));
    expect(current * 48).toBeCloseTo(10, 3);
    const netlist = generateNetlist(circuitFromNets('t', parts), { type: 'tran', step: '1u', stop: '10u' });
    expect(netlist.errors).toEqual([]);
    const result = await runTransient(netlist.text);
    const v = result.voltages.get(netlist.nodeOf.get(terminalKey('lp1', 'a'))!)!;
    expect(v[v.length - 1]).toBeCloseTo(48, 3);
  });

  it('at half its voltage the filament is colder: the current falls as about V^0.54, not by half', () => {
    const sim = new LiveSimulation();
    expect(sim.load(circuitFromNets('t', [supply('24'), lamp('10', '48')]))).toEqual({ ok: true });
    sim.advance(10, 1e-4, 1000);
    const frame = sim.frame()!;
    const power = Math.max(...Array.from(frame.glowMean).filter((x) => !Number.isNaN(x)));
    // About 70% of the current, 3.5 W, where a fixed resistance would take half the current and 2.5 W
    expect(power / 24 / (10 / 48)).toBeGreaterThan(0.65);
    expect(power / 24 / (10 / 48)).toBeLessThan(0.75);
    expect(lampBrightness(power, 10)).toBeGreaterThan(0.4);
    expect(lampBrightness(power, 10)).toBeLessThan(0.6);
  });

  it('at switch-on the cold filament takes about twelve times the current, then warms up, in both engines', async () => {
    // A square wave from 0 to 48 V at 2 Hz: the lamp is off and cold until the first edge
    const square: Part = { def: 'vsource', tag: 'V1', nets: ['p', '0'], props: { shape: 'square', amplitude: '24', offset: '24', frequency: '2', phase: '0', duty: '50', spec: '' } };
    const parts = [square, lamp('10', '48')];
    const compiled = compileCircuit(circuitFromNets('t', parts));
    if (!compiled.ok) throw new Error(compiled.errors.join());
    const engine = new RealtimeEngine(compiled.compiled);
    engine.initialize();
    const index = compiled.compiled.elementIds.indexOf('lp1');
    const h = 1e-5;
    const times = [0.0002, 0.01, 0.04, 0.2];
    const real: number[] = [];
    let t = 0;
    for (const time of times) {
      for (; t < time - h / 2; t += h) engine.step(h);
      real.push(engine.deviceCurrent(index));
    }
    // Inrush near 48 / (230.4 / 12) = 2.5 A, down to 10 W / 48 V = 0.21 A
    expect(real[0]).toBeGreaterThan(2);
    expect(real[1]).toBeLessThan(real[0]);
    expect(real[3]).toBeCloseTo(10 / 48, 2);
    const netlist = generateNetlist(circuitFromNets('t', parts), { type: 'tran', step: '10u', stop: '200m', maxStep: '10u' });
    expect(netlist.errors).toEqual([]);
    const result = await runTransient(netlist.text);
    const v = result.voltages.get(netlist.nodeOf.get(terminalKey('lp1', 'a'))!)!;
    const temperature = result.voltages.get('xtxlp1')!;
    const ng = times.map((time) => {
      const j = result.time.findIndex((x) => x >= time);
      return v[j] / filamentResistance(lampParams({ power: 10, volts: 48 }), temperature[j]);
    });
    real.forEach((current, k) => expect(Math.abs(current - ng[k]) / ng[k]).toBeLessThan(0.03));
  });

  it('on alternating current, shows the mean power, not the instant one', () => {
    const sim = new LiveSimulation();
    const ac: Part = { def: 'vsource', tag: 'V1', nets: ['p', '0'], props: { shape: 'sin', amplitude: String(48 * Math.SQRT2), offset: '0', frequency: '50', phase: '0', duty: '50', spec: '' } };
    expect(sim.load(circuitFromNets('t', [ac, lamp('10', '48')]))).toEqual({ ok: true });
    // Warmed up for half a second, then a whole period of 20 ms in steps of 0.1 ms: 48 V RMS gives the
    // rated 10 W on average
    sim.advance(5000, 1e-4, 100000);
    sim.frame();
    sim.advance(200, 1e-4, 10000);
    const power = Math.max(...Array.from(sim.frame()!.glowMean).filter((x) => !Number.isNaN(x)));
    expect(power).toBeCloseTo(10, 1);
  });

  it('refuses a rating that is not a positive number', () => {
    expect(compileCircuit(circuitFromNets('t', [supply('48'), lamp('0', '48')]))).toMatchObject({ ok: false });
  });
});
