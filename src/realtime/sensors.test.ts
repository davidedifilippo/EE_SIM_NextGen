import { describe, expect, it } from 'vitest';
import { runTransient } from '../engine/ngspice';
import { terminalKey } from '../netlist/connectivity';
import { generateNetlist } from '../netlist/generate';
import { getDevice } from '../library/devices';
import { compileCircuit } from './compile';
import { RealtimeEngine } from './engine';
import { regulatorParams } from './regulator';
import { circuitFromNets, Part } from './testCircuits';

const supply = (volts: string): Part => ({ def: 'vsource', tag: 'V1', nets: ['vs', '0'], props: { shape: 'dc', amplitude: volts, offset: '0', frequency: '50', phase: '0', duty: '50', spec: '' } });
const sensor = (def: 'lm35' | 'tmp36', temp: string): Part => ({ def, tag: 'U1', nets: ['vs', 'out', '0'], props: { temp } });
const load: Part = { def: 'resistor', tag: 'RL', nets: ['out', '0'], props: { value: '10k' } };

function realtime(parts: Part[]) {
  const compiled = compileCircuit(circuitFromNets('t', parts));
  if (!compiled.ok) throw new Error(compiled.errors.join());
  const engine = new RealtimeEngine(compiled.compiled);
  engine.initialize();
  for (let k = 0; k < 5; k++) engine.step(1e-4);
  const index = compiled.compiled.elementIds.indexOf('u1');
  const out = compiled.compiled.devices[compiled.compiled.elementIds.indexOf('rl')]?.a ?? -1;
  return { engine, index, output: () => engine.nodeVoltage(out), compiled: compiled.compiled };
}

async function precise(parts: Part[]) {
  const netlist = generateNetlist(circuitFromNets('t', parts), { type: 'tran', step: '10u', stop: '100u', maxStep: '10u' });
  expect(netlist.errors).toEqual([]);
  const result = await runTransient(netlist.text);
  const values = result.voltages.get(netlist.nodeOf.get(terminalKey('rl', 'a'))!)!;
  return values[values.length - 1];
}

describe('temperature sensors in both engines', () => {
  it.each([
    ['lm35', '5', '25', 0.25],
    ['lm35', '5', '100', 1.0],
    ['lm35', '5', '-20', 0],
    ['tmp36', '5', '-40', 0.1],
    ['tmp36', '5', '25', 0.75],
    ['tmp36', '5', '125', 1.75],
    ['tmp36', '3.3', '125', 1.75],
    ['lm35', '32', '150', 1.5],
  ] as const)('%s at %s V and %s °C gives %s V', async (def, volts, temp, expected) => {
    const parts = [supply(volts), sensor(def, temp), load];
    const real = realtime(parts).output();
    expect(real).toBeCloseTo(expected, 2);
    expect(await precise(parts)).toBeCloseTo(real, 2);
  });

  it('gives nothing below its supply range, and says so', async () => {
    for (const [def, volts] of [['lm35', '3'], ['tmp36', '2']] as const) {
      const parts = [supply(volts), sensor(def, '25'), load];
      const { engine, index, output } = realtime(parts);
      expect(Math.abs(output())).toBeLessThan(1e-3);
      expect(engine.regulatorStatus(index).region).toBe('supply');
      expect(Math.abs(await precise(parts))).toBeLessThan(1e-3);
    }
  });

  it('warns above its supply range but still gives a valid output', () => {
    const { engine, index, output } = realtime([supply('32'), sensor('lm35', '25'), load]);
    expect(output()).toBeCloseTo(0.25, 2);
    expect(engine.regulatorStatus(index).region).toBe('supply');
  });

  it('is damaged past the absolute maximum, and stays so when the supply comes back', () => {
    const high = realtime([supply('40'), sensor('lm35', '25'), load]);
    expect(Math.abs(high.output())).toBeLessThan(1e-3);
    expect(high.engine.regulatorStatus(high.index).region).toBe('damaged');
    const back = realtime([supply('5'), sensor('lm35', '25'), load]);
    back.engine.adoptState(high.engine);
    for (let k = 0; k < 5; k++) back.engine.step(1e-4);
    expect(Math.abs(back.output())).toBeLessThan(1e-3);
    expect(back.engine.regulatorStatus(back.index).region).toBe('damaged');
  });

  it('does not show the current limit for a moment when the temperature jumps', () => {
    const before = realtime([supply('5'), sensor('lm35', '25'), load]);
    const after = realtime([supply('5'), sensor('lm35', '150'), load]);
    after.engine.adoptState(before.engine);
    // Read before the next step, as a frame of the animation may be
    expect(after.engine.regulatorStatus(after.index).region).toBe('regulating');
    after.engine.step(1e-4);
    expect(after.output()).toBeCloseTo(1.5, 2);
    expect(after.engine.regulatorStatus(after.index).region).toBe('regulating');
  });

  it('draws its quiescent current with no load', () => {
    const { engine, compiled } = realtime([supply('5'), sensor('tmp36', '25')]);
    const source = compiled.elementIds.indexOf('v1');
    // 50 µA, and the leak that keeps the nodes defined: 50 nA at 5 V
    expect(Math.abs(engine.deviceCurrent(source))).toBeCloseTo(50e-6, 6);
  });

  it('reads its temperature from the properties, and refuses one that is not a number', () => {
    const def = getDevice('tmp36')!;
    if (def.spice.kind !== 'regulator') throw new Error('not a sensor');
    const el = { id: 'u1', def: 'tmp36', x: 0, y: 0, rot: 0 as const, tag: 'U1', props: { temp: '50' } };
    expect(regulatorParams(el, def.spice)?.vNominal).toBeCloseTo(1.0, 9);
    expect(regulatorParams({ ...el, props: { temp: 'caldo' } }, def.spice)).toBeNull();
    expect(def.category).toBe('Sensori');
  });
});
