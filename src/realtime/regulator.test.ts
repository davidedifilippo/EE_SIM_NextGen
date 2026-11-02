import { describe, expect, it } from 'vitest';
import { runTransient } from '../engine/ngspice';
import { terminalKey } from '../netlist/connectivity';
import { generateNetlist } from '../netlist/generate';
import { compileCircuit } from './compile';
import { RealtimeEngine } from './engine';
import { THERMAL_RESTART, THERMAL_SHUTDOWN } from './regulator';
import { circuitFromNets, Part } from './testCircuits';
import { regulatorSummaries } from '../ui/regulatorPower';

const R = (tag: string, a: string, b: string, value: string): Part => ({ def: 'resistor', tag, nets: [a, b], props: { value } });
const C = (tag: string, a: string, b: string, value: string): Part => ({ def: 'capacitor', tag, nets: [a, b], props: { value } });
const V = (value: string): Part => ({ def: 'vsource', tag: 'V1', nets: ['in', '0'], props: { shape: 'dc', amplitude: value, offset: '0', frequency: '50', phase: '0', duty: '50', spec: '' } });
const SINE = (amplitude: string): Part => ({ def: 'vsource', tag: 'V1', nets: ['ac', '0'], props: { shape: 'sin', amplitude, offset: '0', frequency: '50', phase: '0', duty: '50', spec: '' } });
const reg = (def: Part['def'], nets: [string, string, string], props: Record<string, string> = {}): Part => ({ def, tag: 'U1', nets, props: { model: '', imax: '2.2', dropout: '2', rth: '65', ta: '25', ...props } });

const build = (parts: Part[]) => {
  const circuit = circuitFromNets('t', parts);
  const compiled = compileCircuit(circuit);
  if (!compiled.ok) throw new Error(compiled.errors.join());
  const engine = new RealtimeEngine(compiled.compiled);
  engine.initialize();
  const index = compiled.compiled.elementIds.indexOf('u1');
  const device = compiled.compiled.devices[index] as { a: number; b: number; base: number };
  return { engine, index, output: () => engine.nodeVoltage(device.b) - engine.nodeVoltage(device.base) };
};

describe('the simple behaviour, against the formulas', () => {
  it('7805: 5 V whatever the input, within its load regulation', () => {
    const { output, engine, index } = build([V('12'), reg('reg7805', ['in', 'out', '0']), R('RL', 'out', '0', '1k')]);
    expect(output()).toBeCloseTo(5, 3);
    expect(engine.terminalCurrents(index)[1]).toBeCloseTo(-5e-3, 5);
  });

  it('with a heavier load it still regulates, a little lower', () => {
    const { output } = build([V('12'), reg('reg7805', ['in', 'out', '0']), R('RL', 'out', '0', '10')]);
    expect(output()).toBeLessThan(5);
    expect(output()).toBeGreaterThan(4.99 - 0.01);
  });

  it('below the minimum drop it follows the input', () => {
    expect(build([V('6'), reg('reg7805', ['in', 'out', '0']), R('RL', 'out', '0', '1k')]).output()).toBeCloseTo(4, 2);
  });

  it('with no input the output is off', () => {
    expect(build([V('1'), reg('reg7805', ['in', 'out', '0']), R('RL', 'out', '0', '1k')]).output()).toBeCloseTo(0, 6);
  });

  it('a short on the output stops at the current limit', () => {
    const { engine, index } = build([V('12'), reg('reg7805', ['in', 'out', '0']), R('RL', 'out', '0', '0.01')]);
    expect(engine.terminalCurrents(index)[1]).toBeCloseTo(-2.2, 6);
    expect(engine.regulatorStatus(index).region).toBe('limit');
  });

  it('it gives current and does not take it', () => {
    const { engine, index, output } = build([V('12'), reg('reg7805', ['in', 'out', '0']), R('RL', 'out', 'x', '100'), { def: 'vsource', tag: 'V2', nets: ['x', '0'], props: { shape: 'dc', amplitude: '9', offset: '0', frequency: '50', phase: '0', duty: '50', spec: '' } }]);
    expect(output()).toBeCloseTo(9, 2);
    expect(Math.abs(engine.terminalCurrents(index)[1])).toBeLessThan(1e-9);
  });

  it('7905: the same, with the signs reversed', () => {
    const { output, engine, index } = build([V('-12'), reg('reg7905', ['in', 'out', '0']), R('RL', 'out', '0', '1k')]);
    expect(output()).toBeCloseTo(-5, 3);
    expect(engine.terminalCurrents(index)[1]).toBeCloseTo(5e-3, 5);
  });

  it('LM317: 1.25 V between output and ADJ, set by the resistors', () => {
    const circuit = build([V('12'), reg('reglm317', ['in', 'out', 'adj']), R('R1', 'out', 'adj', '240'), R('R2', 'adj', '0', '720')]);
    const expected = 1.25 * (1 + 720 / 240) + 50e-6 * 720;
    const out = circuit.engine.compiled.devices[circuit.index] as { b: number };
    expect(circuit.engine.nodeVoltage(out.b)).toBeCloseTo(expected, 2);
  });
});

describe('the balance', () => {
  it('what enters is what leaves plus its own consumption, and the heat adds up', () => {
    const { engine, index } = build([V('12'), reg('reg7805', ['in', 'out', '0']), R('RL', 'out', '0', '100')]);
    const [input, output, reference] = engine.terminalCurrents(index);
    expect(input + output + reference).toBeCloseTo(0, 12);
    expect(input).toBeCloseTo(-output + 5e-3, 12);
    const v = 5 + output * 1e-2;
    expect(engine.regulatorStatus(index).power).toBeCloseTo((12 - v) * -output + 12 * 5e-3, 3);
  });
});

describe('the thermal protection', () => {
  it('shuts down beyond its limit and starts again once cooled, over and over', () => {
    const { engine, index, output } = build([V('12'), reg('reg7805', ['in', 'out', '0']), R('RL', 'out', '0', '5')]);
    const seen = { off: 0, on: 0, hottest: 0, coolest: Infinity };
    let wasOff = false;
    for (let k = 0; k < 60000; k++) {
      engine.step(1e-5);
      const { region, temperature } = engine.regulatorStatus(index);
      const isOff = region === 'thermal';
      if (isOff && !wasOff) seen.off++;
      if (!isOff && wasOff) seen.on++;
      wasOff = isOff;
      seen.hottest = Math.max(seen.hottest, temperature);
      if (seen.off > 0) seen.coolest = Math.min(seen.coolest, temperature);
    }
    expect(seen.off).toBeGreaterThan(1);
    expect(seen.on).toBeGreaterThan(0);
    expect(seen.hottest).toBeLessThan(THERMAL_SHUTDOWN + 2);
    expect(seen.coolest).toBeGreaterThan(THERMAL_RESTART - 2);
    expect(Number.isFinite(output())).toBe(true);
  });

  it('never acts with little heat', () => {
    const { engine, index, output } = build([V('12'), reg('reg7805', ['in', 'out', '0']), R('RL', 'out', '0', '1k')]);
    for (let k = 0; k < 40000; k++) engine.step(1e-5);
    const { region, temperature } = engine.regulatorStatus(index);
    expect(region).toBe('regulating');
    // (12 - 5) * 5 mA + 12 * 5 mA = 95 mW, at 65 degrees per watt
    expect(temperature).toBeCloseTo(25 + 0.095 * 65, 0);
    expect(output()).toBeCloseTo(5, 3);
  });

  it('a smaller thermal resistance, as with a heatsink, lets the same load run', () => {
    const { engine, index } = build([V('12'), reg('reg7805', ['in', 'out', '0'], { rth: '5' }), R('RL', 'out', '0', '5')]);
    for (let k = 0; k < 40000; k++) engine.step(1e-5);
    expect(engine.regulatorStatus(index).region).toBe('regulating');
  });
});

describe('the power, from the precise analysis', () => {
  const summary = async (parts: Part[]) => {
    const circuit = circuitFromNets('t', parts);
    const netlist = generateNetlist(circuit, { type: 'tran', step: '5u', stop: '1m', maxStep: '5u' });
    expect(netlist.errors).toEqual([]);
    return regulatorSummaries(circuit, netlist.nodeOf, await runTransient(netlist.text))[0];
  };

  it('adds up, and the protection stays out of it with little heat', async () => {
    const r = await summary([V('12'), reg('reg7805', ['in', 'out', '0']), R('RL', 'out', '0', '1k')]);
    expect(r.power).toBeCloseTo(0.095, 3);
    expect(r.temperature).toBeCloseTo(25 + 0.095 * 65, 1);
    expect(r.wouldShutDown).toBe(false);
  });

  it('says when the protection would act', async () => {
    const r = await summary([V('12'), reg('reg7805', ['in', 'out', '0']), R('RL', 'out', '0', '5')]);
    expect(r.power).toBeGreaterThan(7);
    expect(r.wouldShutDown).toBe(true);
  });

  it('works on the negative parts too', async () => {
    const r = await summary([V('-12'), reg('reg7905', ['in', 'out', '0']), R('RL', 'out', '0', '1k')]);
    expect(r.power).toBeCloseTo(0.095, 3);
  });
});

describe('robustness', () => {
  it('runs with its pins unconnected', () => {
    const circuit = circuitFromNets('t', [V('12'), R('RL', 'in', '0', '1k')]);
    const element = { id: 'u1', def: 'reg7805', x: 400, y: 400, rot: 0 as const, tag: 'U1', props: { model: '', imax: '2.2', dropout: '2', rth: '65', ta: '25' } };
    const compiled = compileCircuit({ ...circuit, elements: [...circuit.elements, element] });
    if (!compiled.ok) throw new Error(compiled.errors.join());
    const engine = new RealtimeEngine(compiled.compiled);
    engine.initialize();
    engine.step(1e-5);
    expect(Number.isFinite(engine.time)).toBe(true);
  });

  it('refuses values that make no sense', () => {
    const circuit = circuitFromNets('t', [V('12'), reg('reg7805', ['in', 'out', '0'], { imax: '0' }), R('RL', 'out', '0', '1k')]);
    expect(compileCircuit(circuit)).toEqual({ ok: false, errors: ['U1: valori del regolatore non validi'] });
    expect(generateNetlist(circuit, { type: 'tran', step: '1u', stop: '10u' }).errors).toEqual(['U1: valori del regolatore non validi']);
  });
});

describe('with an imported model', () => {
  const MODEL = '.subckt MY7805 OUT GND IN\nB1 OUT GND V=min(5,max(0,v(IN,GND)-2))\nRQ IN GND 2k\n.ends';
  const models = [{ name: 'MY7805', card: MODEL }];
  const circuit = (props: Record<string, string>) => ({ ...circuitFromNets('t', [V('12'), reg('reg7805', ['in', 'out', '0'], props), R('RL', 'out', '0', '100')]), models });

  it('takes the pins by their names, in any order', async () => {
    const c = circuit({ model: 'MY7805' });
    const netlist = generateNetlist(c, { type: 'tran', step: '1u', stop: '10u' });
    expect(netlist.errors).toEqual([]);
    const node = (t: string) => netlist.nodeOf.get(terminalKey('u1', t));
    expect(netlist.text).toContain(`XU1 xoXU1 ${node('ref')} ${node('in')} MY7805`);
    const result = await runTransient(netlist.text);
    expect(result.voltages.get(node('out')!)![result.time.length - 1]).toBeCloseTo(5, 3);
    expect(result.currents.get('vsxu1')![result.time.length - 1]).toBeCloseTo(0.05, 3);
  });

  it('stays simple in the animation', () => {
    const compiled = compileCircuit(circuit({ model: 'MY7805' }));
    expect(compiled.ok).toBe(true);
  });

  it('asks for one role per pin', () => {
    const netlist = generateNetlist(circuit({ model: 'MY7805', pins: 'in in out' }), { type: 'tran', step: '1u', stop: '10u' });
    expect(netlist.errors).toEqual(['U1: i piedini del modello "MY7805" non sono assegnati uno per funzione']);
  });
});

/** Same circuit in both engines. The thermal protection is left out by a small resistance, as ngspice does not have it. */
describe('the two engines agree', () => {
  const COOL = { rth: '0.01' };
  const compare = async (parts: Part[], node: string, stop: number, dt: number) => {
    const circuit = circuitFromNets('t', parts);
    const netlist = generateNetlist(circuit, { type: 'tran', step: String(dt), stop: String(stop), maxStep: String(dt) });
    expect(netlist.errors).toEqual([]);
    const spice = await runTransient(netlist.text);
    const owner = parts.find((p) => p.nets.includes(node))!;
    const { getDevice } = await import('../library/devices');
    const terminal = getDevice(owner.def)!.terminals[owner.nets.indexOf(node)].id;
    const key = terminalKey(owner.tag.toLowerCase(), terminal);
    const series = spice.voltages.get(netlist.nodeOf.get(key)!)!;

    const compiled = compileCircuit(circuit);
    if (!compiled.ok) throw new Error(compiled.errors.join());
    const engine = new RealtimeEngine(compiled.compiled);
    engine.initialize();
    const { computeConnectivity } = await import('../netlist/connectivity');
    const index = compiled.compiled.netIndex.get(computeConnectivity(circuit).netOf.get(key)!)!;
    let worst = 0;
    let cursor = 0;
    const steps = Math.round(stop / dt);
    for (let k = 1; k <= steps; k++) {
      engine.step(dt);
      while (cursor + 2 < spice.time.length && spice.time[cursor + 1] < engine.time) cursor++;
      const u = (engine.time - spice.time[cursor]) / (spice.time[cursor + 1] - spice.time[cursor]);
      worst = Math.max(worst, Math.abs(engine.nodeVoltage(index) - (series[cursor] + u * (series[cursor + 1] - series[cursor]))));
    }
    const scale = Math.max(...series.map(Math.abs), 1e-9);
    return worst / scale;
  };

  it.each<[string, Part[], string]>([
    ['regolazione', [V('12'), reg('reg7805', ['in', 'out', '0'], COOL), R('RL', 'out', '0', '100')], 'out'],
    ['caduta', [V('6'), reg('reg7805', ['in', 'out', '0'], COOL), R('RL', 'out', '0', '100')], 'out'],
    ['limite di corrente', [V('12'), reg('reg7805', ['in', 'out', '0'], COOL), R('RL', 'out', '0', '1')], 'out'],
    ['negativo', [V('-12'), reg('reg7905', ['in', 'out', '0'], COOL), R('RL', 'out', '0', '100')], 'out'],
    ['regolabile', [V('12'), reg('reglm317', ['in', 'out', 'adj'], COOL), R('R1', 'out', 'adj', '240'), R('R2', 'adj', '0', '720')], 'out'],
    ['con il condensatore in uscita', [V('12'), reg('reg7805', ['in', 'out', '0'], COOL), C('C1', 'out', '0', '10u'), R('RL', 'out', '0', '100')], 'out'],
  ])('%s', async (_, parts, node) => {
    expect(await compare(parts, node, 1e-3, 5e-6)).toBeLessThan(0.01);
  });

  it('alimentatore con ponte a semionda e condensatore', async () => {
    const supply: Part[] = [SINE('15'), { def: 'diode', tag: 'D1', nets: ['ac', 'in'], props: { model: 'D1N4148' } }, C('C1', 'in', '0', '100u'), reg('reg7805', ['in', 'out', '0'], COOL), C('C2', 'out', '0', '1u'), R('RL', 'out', '0', '1k')];
    expect(await compare(supply, 'out', 60e-3, 10e-6)).toBeLessThan(0.01);
  });
});
