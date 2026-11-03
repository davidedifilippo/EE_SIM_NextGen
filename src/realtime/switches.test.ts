import { describe, expect, it } from 'vitest';
import { runTransient } from '../engine/ngspice';
import { terminalKey } from '../netlist/connectivity';
import { generateNetlist } from '../netlist/generate';
import { compileCircuit } from './compile';
import { RealtimeEngine } from './engine';
import { closedWay, CONTACT_CLOSED, CONTACT_OPEN, contactResistances } from './switches';
import { circuitFromNets, Part } from './testCircuits';
import { Circuit } from '../model/types';

describe('contacts', () => {
  it('toggle: open at rest, closed when set, and it stays', () => {
    expect(contactResistances('toggle', {})).toEqual([CONTACT_OPEN]);
    expect(contactResistances('toggle', { closed: '1' })).toEqual([CONTACT_CLOSED]);
    expect(contactResistances('toggle', { closed: '0', pressed: '1' })).toEqual([CONTACT_OPEN]);
  });

  it('push buttons: closed or open only while pressed', () => {
    expect(contactResistances('pushno', {})).toEqual([CONTACT_OPEN]);
    expect(contactResistances('pushno', { pressed: '1' })).toEqual([CONTACT_CLOSED]);
    expect(contactResistances('pushnc', {})).toEqual([CONTACT_CLOSED]);
    expect(contactResistances('pushnc', { pressed: '1' })).toEqual([CONTACT_OPEN]);
  });

  it('changeover: always one way closed, the first at rest', () => {
    expect(closedWay('spdt', {})).toBe(0);
    expect(contactResistances('spdt', { position: '1' })).toEqual([CONTACT_CLOSED, CONTACT_OPEN]);
    expect(contactResistances('spdt', { position: '2' })).toEqual([CONTACT_OPEN, CONTACT_CLOSED]);
  });
});

const supply: Part = { def: 'dcsupply', tag: 'V1', nets: ['in', '0'], props: { shape: 'dc', amplitude: '5', rint: '0' } };
const R = (tag: string, a: string, b: string, value: string): Part => ({ def: 'resistor', tag, nets: [a, b], props: { value } });

/** Voltage at the first terminal of a part, in the animation and in ngspice. */
async function both(source: Part[] | Circuit, id: string, terminal: string) {
  const circuit = Array.isArray(source) ? circuitFromNets('t', source) : source;
  const compiled = compileCircuit(circuit);
  if (!compiled.ok) throw new Error(compiled.errors.join());
  const engine = new RealtimeEngine(compiled.compiled);
  engine.initialize();
  const netlist = generateNetlist(circuit, { type: 'tran', step: '1u', stop: '10u', maxStep: '1u' });
  expect(netlist.errors).toEqual([]);
  const result = await runTransient(netlist.text);
  const name = netlist.nodeOf.get(terminalKey(id, terminal))!;
  const ng = name === '0' ? 0 : result.voltages.get(name)![result.time.length - 1];
  const index = compiled.compiled.elementIds.indexOf(id);
  const real = engine.nodeVoltage(compiled.compiled.devices[index].a);
  return { real, ng };
}

/**
 * Supply on the way 1, ground on the way 2, a load on the common. Drawn by hand: the automatic layout
 * of the tests runs the lead of the common over the contact 2.
 */
const changeover = (position: string): Circuit => ({
  title: 't',
  elements: [
    { id: 'v1', def: 'dcsupply', x: 120, y: -60, rot: 270, tag: 'V1', props: { shape: 'dc', amplitude: '5', rint: '0' } },
    { id: 's1', def: 'spdt', x: 0, y: 0, rot: 0, tag: 'S1', props: { position } },
    { id: 'rl', def: 'resistor', x: -80, y: 40, rot: 90, tag: 'RL', props: { value: '10k' } },
    { id: 'g', def: 'ground', x: 40, y: 100, rot: 0, tag: '', props: {} },
  ],
  wires: [
    { id: 'w1', pts: [{ x: 40, y: -20 }, { x: 120, y: -20 }] },
    { id: 'w2', pts: [{ x: 40, y: 20 }, { x: 40, y: 100 }] },
    { id: 'w3', pts: [{ x: 120, y: -100 }, { x: 160, y: -100 }, { x: 160, y: 100 }, { x: 40, y: 100 }] },
    { id: 'w4', pts: [{ x: -40, y: 0 }, { x: -80, y: 0 }] },
    { id: 'w5', pts: [{ x: -80, y: 80 }, { x: -80, y: 100 }, { x: 40, y: 100 }] },
  ],
  models: [],
});

describe('contacts in both engines', () => {
  it.each([
    ['0', 0],
    ['1', 2.5],
  ] as const)('a toggle %s in a divider of two 1k gives %s V, the same in ngspice', async (closed, expected) => {
    const parts: Part[] = [supply, { def: 'switch', tag: 'S1', nets: ['in', 'm'], props: { closed } }, R('R1', 'm', 'x', '1k'), R('R2', 'x', '0', '1k')];
    const { real, ng } = await both(parts, 'r2', 'a');
    expect(real).toBeCloseTo(expected, 3);
    expect(ng).toBeCloseTo(expected, 3);
  });

  it.each([
    ['1', 5],
    ['2', 0],
  ] as const)('a changeover on way %s brings %s V to a load', async (position, expected) => {
    const { real, ng } = await both(changeover(position), 'rl', 'a');
    expect(real).toBeCloseTo(expected, 3);
    expect(ng).toBeCloseTo(expected, 3);
  });

  it('a push button closes the circuit only while pressed', async () => {
    const at = (pressed: string): Part[] => [supply, { def: 'pushno', tag: 'S1', nets: ['in', 'x'], props: { pressed } }, R('RL', 'x', '0', '1k')];
    expect((await both(at('0'), 'rl', 'a')).real).toBeCloseTo(0, 3);
    expect((await both(at('1'), 'rl', 'a')).real).toBeCloseTo(5, 3);
  });
});
