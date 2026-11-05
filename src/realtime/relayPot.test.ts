import { describe, expect, it } from 'vitest';
import { runTransient } from '../engine/ngspice';
import { terminalKey } from '../netlist/connectivity';
import { generateNetlist } from '../netlist/generate';
import { getDevice } from '../library/devices';
import { compileCircuit } from './compile';
import { RealtimeEngine } from './engine';
import { nextRelayState, relayThresholds } from './relay';
import { circuitFromNets, Part } from './testCircuits';

const dc = (tag: string, plus: string, volts: string): Part => ({ def: 'vsource', tag, nets: [plus, '0'], props: { shape: 'dc', amplitude: volts, offset: '0', frequency: '50', phase: '0', duty: '50', spec: '' } });
const pot = (position: string): Part => ({ def: 'potentiometer', tag: 'P1', nets: ['top', '0', 'w'], props: { value: '10k', position } });
const resistor = (tag: string, a: string, b: string, value: string): Part => ({ def: 'resistor', tag, nets: [a, b], props: { value } });

function realtime(parts: Part[]) {
  const compiled = compileCircuit(circuitFromNets('t', parts));
  if (!compiled.ok) throw new Error(compiled.errors.join());
  const engine = new RealtimeEngine(compiled.compiled);
  engine.initialize();
  const index = (id: string) => compiled.compiled.elementIds.indexOf(id);
  return { engine, index };
}

const specOf = (id: string) => {
  const spice = getDevice(id)!.spice;
  if (spice.kind !== 'relay') throw new Error('not a relay');
  return spice.spec;
};

describe('the potentiometer', () => {
  it('divides as the wiper says, in both engines', async () => {
    for (const [position, expected] of [['30', 7], ['0', 10], ['100', 0]] as const) {
      const parts = [dc('V1', 'top', '10'), pot(position), resistor('RL', 'w', '0', '1g')];
      const { engine, index } = realtime(parts);
      // The voltage of the wiper, from the current that leaves the grounded end b
      const [, ib] = engine.terminalCurrents(index('p1'));
      const wiper = -ib * Math.max(10e3 * (1 - Number(position) / 100), 1e-3);
      expect(wiper).toBeCloseTo(expected, 3);
      const netlist = generateNetlist(circuitFromNets('t', parts), { type: 'tran', step: '1u', stop: '10u' });
      expect(netlist.errors).toEqual([]);
      const result = await runTransient(netlist.text);
      const v = result.voltages.get(netlist.nodeOf.get(terminalKey('p1', 'w'))!);
      expect(v ? v[v.length - 1] : NaN).toBeCloseTo(expected, 3);
    }
  });

  it('refuses a wiper beyond its ends', () => {
    expect(compileCircuit(circuitFromNets('t', [dc('V1', 'top', '10'), pot('120')]))).toMatchObject({ ok: false });
  });
});

describe('the relay', () => {
  it('picks up and drops out at the currents of the datasheet, with hysteresis', () => {
    const spec = specOf('relay5');
    const { pickup, dropout } = relayThresholds(spec);
    expect(pickup).toBeCloseTo(3.75 / 70, 9);
    expect(dropout).toBeCloseTo(0.5 / 70, 9);
    expect(nextRelayState(spec, false, 0.05)).toBe(false);
    expect(nextRelayState(spec, false, 0.06)).toBe(true);
    expect(nextRelayState(spec, true, 0.01)).toBe(true);
    expect(nextRelayState(spec, true, 0.005)).toBe(false);
    // The coil pulls in with the current either way
    expect(nextRelayState(spec, false, -0.06)).toBe(true);
  });

  it('closes its contact with the coil fed above the pick-up voltage only', () => {
    for (const [volts, isClosed] of [['5', true], ['3.5', false]] as const) {
      const parts: Part[] = [dc('V1', 'c', volts), { def: 'relay5', tag: 'K1', nets: ['c', '0', 'x', '0'], props: {} }, dc('V2', 's', '12'), resistor('RL', 's', 'x', '100')];
      const { engine, index } = realtime(parts);
      const k = index('k1');
      expect(engine.relayIsClosed(k)).toBe(isClosed);
      expect(engine.deviceCurrent(k)).toBeCloseTo(Number(volts) / 70, 6);
      // Into the contact at 13: all of the 12 V on the load when closed, nothing when open
      expect(engine.terminalCurrents(k)[2]).toBeCloseTo(isClosed ? 0.12 : 0, 4);
    }
  });

  it('closes and opens at the same instants in both engines', async () => {
    // 0 to 5 V at 20 Hz on the coil: up at 0, down at 25 ms; 12 V through 100 ohms on the contact
    const square: Part = { def: 'vsource', tag: 'V1', nets: ['c', '0'], props: { shape: 'square', amplitude: '2.5', offset: '2.5', frequency: '20', phase: '0', duty: '50', spec: '' } };
    const parts: Part[] = [square, { def: 'relay5', tag: 'K1', nets: ['c', '0', 'x', '0'], props: {} }, dc('V2', 's', '12'), resistor('RL', 's', 'x', '100')];
    const h = 1e-5;
    const { engine, index } = realtime(parts);
    const k = index('k1');
    const real: number[] = [];
    for (let t = 0; t < 0.045; t += h) {
      engine.step(h);
      real.push(engine.terminalCurrents(k)[2]);
    }
    const netlist = generateNetlist(circuitFromNets('t', parts), { type: 'tran', step: '10u', stop: '45m', maxStep: '10u' });
    expect(netlist.errors).toEqual([]);
    const result = await runTransient(netlist.text);
    const vx = result.voltages.get(netlist.nodeOf.get(terminalKey('k1', '13'))!)!;
    // The instants the contact current crosses half its value, closing and opening
    const crossings = (times: number[], currents: number[]) => {
      const closed = currents.map((i) => i > 0.06);
      return closed.flatMap((c, j) => (j > 0 && c !== closed[j - 1] ? [times[j]] : []));
    };
    const realEdges = crossings(real.map((_, j) => (j + 1) * h), real);
    const ngEdges = crossings(result.time, vx.map((v) => (12 - v) / 100));
    expect(realEdges.length).toBe(2);
    expect(ngEdges.length).toBe(2);
    // Closing at about 1.4 coil time constants after the edge, opening at about 2.3 after the fall
    const tau = 0.2 / 70;
    expect(realEdges[0]).toBeCloseTo(-tau * Math.log(1 - 3.75 / 5), 3);
    expect(realEdges[1]).toBeCloseTo(0.025 + tau * Math.log(5 / 0.5), 3);
    realEdges.forEach((t, j) => expect(Math.abs(t - ngEdges[j])).toBeLessThan(5e-5));
  });
});
