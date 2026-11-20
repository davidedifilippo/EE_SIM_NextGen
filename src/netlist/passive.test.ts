import { describe, expect, it } from 'vitest';
import { runTransient } from '../engine/ngspice';
import { compileCircuit } from '../realtime/compile';
import { RealtimeEngine } from '../realtime/engine';
import { circuitFromNets, Part } from '../realtime/testCircuits';
import { terminalKey } from './connectivity';
import { generateNetlist } from './generate';

/** A load of its rating on a DC supply, through 1 Ω: the current in the animation and in ngspice. */
async function currents(power: string, volts: string, supply: number) {
  const parts: Part[] = [
    { def: 'dcsupply', tag: 'V1', nets: ['p', '0'], props: { shape: 'dc', amplitude: String(supply), rint: '0' } },
    { def: 'resistor', tag: 'R1', nets: ['p', 'x'], props: { value: '1' } },
    { def: 'load', tag: 'RL1', nets: ['x', '0'], props: { power, volts } },
  ];
  const circuit = circuitFromNets('t', parts);
  const compiled = compileCircuit(circuit);
  if (!compiled.ok) throw new Error(compiled.errors.join());
  const engine = new RealtimeEngine(compiled.compiled);
  engine.initialize();
  const real = Math.abs(engine.deviceCurrent(compiled.compiled.elementIds.indexOf('r1')));
  const netlist = generateNetlist(circuit, { type: 'tran', step: '1u', stop: '10u', maxStep: '1u' });
  expect(netlist.errors).toEqual([]);
  const result = await runTransient(netlist.text);
  const v = (name: string) => {
    const values = result.voltages.get(netlist.nodeOf.get(terminalKey('r1', name))!)!;
    return values[values.length - 1];
  };
  return { real, ng: v('a') - v('b') };
}

describe('the generic load', () => {
  it.each([
    ['500', '230', 230, 'an oven'],
    ['1000', '230', 230, 'a water heater'],
    ['48', '12', 12, 'a camper fridge'],
  ])('%s W at %s V takes its rated power at its rated voltage: %s', async (power, volts, supply) => {
    const r = Number(volts) ** 2 / Number(power);
    const expected = supply / (r + 1);
    const { real, ng } = await currents(power, volts, supply);
    expect(real).toBeCloseTo(expected, 4);
    expect(ng).toBeCloseTo(expected, 4);
  });

  it('refuses a rating that is not a positive number, in both engines', () => {
    const circuit = circuitFromNets('t', [
      { def: 'dcsupply', tag: 'V1', nets: ['p', '0'], props: { shape: 'dc', amplitude: '12', rint: '0' } },
      { def: 'load', tag: 'RL1', nets: ['p', '0'], props: { power: '0', volts: '12' } },
    ]);
    const compiled = compileCircuit(circuit);
    expect(compiled.ok ? [] : compiled.errors).toEqual(['RL1: potenza o tensione nominale non valida']);
    expect(generateNetlist(circuit, { type: 'tran', step: '1u', stop: '10u' }).errors).toEqual(['RL1: potenza o tensione nominale non valida']);
  });
});
