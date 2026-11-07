import { describe, expect, it } from 'vitest';
import { runTransient } from '../engine/ngspice';
import { terminalKey } from '../netlist/connectivity';
import { generateNetlist } from '../netlist/generate';
import { getDevice } from '../library/devices';
import { compileCircuit } from './compile';
import { RealtimeEngine } from './engine';
import { nextRelayState, relayThresholds } from './relay';
import { circuitFromNets, Part } from './testCircuits';
import { EXAMPLES } from '../samples/examples';
import { Circuit } from '../model/types';
import { computeConnectivity } from '../netlist/connectivity';

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

describe('the changeover relay', () => {
  /** The example: K1 between two lamps on 12 V, its coil on V1 through S1, here closed, with V1 as given. */
  const example = (v1: Record<string, string>) => {
    const circuit = EXAMPLES.find((e) => e.id === 'relay_spdt')!.build();
    circuit.elements = circuit.elements.map((el) => (el.id === 'v1' ? { ...el, def: 'vsource', props: { ...el.props, ...v1 } } : el.id === 's1' ? { ...el, props: { ...el.props, closed: '1' } } : el));
    return circuit;
  };
  /** The voltage of each way of K1 in the animation, by its terminal. */
  const ways = (circuit: Circuit) => {
    const compiled = compileCircuit(circuit);
    if (!compiled.ok) throw new Error(compiled.errors.join());
    const engine = new RealtimeEngine(compiled.compiled);
    engine.initialize();
    const { netOf } = computeConnectivity(circuit);
    const at = (terminal: string) => {
      const node = compiled.compiled.netIndex.get(netOf.get(terminalKey('k1', terminal))!)!;
      return () => engine.nodeVoltage(node);
    };
    return { engine, k: compiled.compiled.elementIds.indexOf('k1'), no: at('14'), nc: at('12') };
  };

  it('rests on the normally closed way, and moves to the normally open one with the coil fed', () => {
    for (const [volts, isPulled] of [['0', false], ['5', true]] as const) {
      const { engine, k, no, nc } = ways(example({ shape: 'dc', amplitude: volts }));
      expect(engine.relayIsClosed(k)).toBe(isPulled);
      expect(no()).toBeCloseTo(isPulled ? 12 : 0, 1);
      expect(nc()).toBeCloseTo(isPulled ? 0 : 12, 1);
    }
  });

  it('both ways change at the same instants in both engines', async () => {
    // 0 to 5 V at 20 Hz on the coil: up at 0, down at 25 ms
    const circuit = example({ shape: 'square', amplitude: '2.5', offset: '2.5', frequency: '20', phase: '0', duty: '50', spec: '', rint: '0' });
    const { engine, no, nc } = ways(circuit);
    const h = 1e-5;
    const [noTrace, ncTrace, times]: number[][] = [[], [], []];
    for (let t = 0; t < 0.045; t += h) {
      engine.step(h);
      noTrace.push(no());
      ncTrace.push(nc());
      times.push(engine.time);
    }
    const netlist = generateNetlist(circuit, { type: 'tran', step: '10u', stop: '45m', maxStep: '10u' });
    expect(netlist.errors).toEqual([]);
    const result = await runTransient(netlist.text);
    const ngAt = (terminal: string) => result.voltages.get(netlist.nodeOf.get(terminalKey('k1', terminal))!)!;
    const edgesOf = (time: ArrayLike<number>, values: ArrayLike<number>) => {
      const edges: number[] = [];
      for (let j = 1; j < values.length; j++) if (values[j] > 6 !== values[j - 1] > 6) edges.push(time[j]);
      return edges;
    };
    const [realNo, realNc] = [edgesOf(times, noTrace), edgesOf(times, ncTrace)];
    const [ngNo, ngNc] = [edgesOf(result.time, ngAt('14')), edgesOf(result.time, ngAt('12'))];
    // The normally closed way opens as the coil pulls in, and closes again as it lets go
    expect(realNo).toHaveLength(2);
    expect(realNc).toHaveLength(2);
    realNo.forEach((t, j) => expect(Math.abs(t - realNc[j])).toBeLessThan(2 * h));
    realNo.forEach((t, j) => expect(Math.abs(t - ngNo[j])).toBeLessThan(1e-4));
    realNc.forEach((t, j) => expect(Math.abs(t - ngNc[j])).toBeLessThan(1e-4));
    // ngspice follows the filaments of the two lamps too: slower than the others
  }, 30000);
});
