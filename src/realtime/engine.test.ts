import { describe, expect, it } from 'vitest';
import { formatSpiceValue, parseSpiceValue } from '../netlist/values';
import { terminalKey } from '../netlist/connectivity';
import { computeConnectivity } from '../netlist/connectivity';
import { Circuit, SpiceModel } from '../model/types';
import { compileCircuit, parseBjtModel, parseDiodeModel, parseMosModel } from './compile';
import { RealtimeEngine, SolverError } from './engine';
import { circuitFromNets, Part, RELAXATION_OSCILLATOR } from './testCircuits';
import { parseWaveform } from './waveform';

const build = (parts: Part[], models: SpiceModel[] = []) => {
  const circuit = circuitFromNets('t', parts);
  circuit.models.push(...models);
  const result = compileCircuit(circuit);
  if (!result.ok) throw new Error(result.errors.join());
  const { netOf } = computeConnectivity(circuit);
  const engine = new RealtimeEngine(result.compiled);
  const node = (tag: string, terminal: string) => result.compiled.netIndex.get(netOf.get(terminalKey(tag, terminal))!)!;
  return { engine, node, compiled: result.compiled, circuit };
};

const R = (tag: string, a: string, b: string, value: string): Part => ({ def: 'resistor', tag, nets: [a, b], props: { value } });
const C = (tag: string, a: string, b: string, value: string): Part => ({ def: 'capacitor', tag, nets: [a, b], props: { value } });
const L = (tag: string, a: string, b: string, value: string): Part => ({ def: 'inductor', tag, nets: [a, b], props: { value } });
const V = (tag: string, a: string, b: string, spec: string): Part => ({ def: 'vsource', tag, nets: [a, b], props: { spec } });

describe('values', () => {
  it.each([
    ['1k', 1e3],
    ['4.7meg', 4.7e6],
    ['100u', 1e-4],
    ['1e3', 1e3],
    ['10m', 0.01],
    ['2.2nF', 2.2e-9],
  ])('parses %s', (text, value) => {
    expect(parseSpiceValue(text)).toBeCloseTo(value, 12);
  });

  it('rejects text that is not a number', () => {
    expect(parseSpiceValue('abc')).toBeNull();
    expect(parseSpiceValue('')).toBeNull();
  });

  it.each([
    [4700, '4.7k'],
    [1e-4, '100u'],
    [2.2e6, '2.2meg'],
    [0.5, '500m'],
    [1, '1'],
  ])('formats %d', (value, text) => {
    expect(formatSpiceValue(value)).toBe(text);
  });
});

describe('waveforms', () => {
  it('follows SPICE SIN, holding the value before the delay', () => {
    const w = parseWaveform('SIN(1 2 50 0.01)')!;
    expect(w(0)).toBeCloseTo(1, 9);
    expect(w(0.01 + 0.005)).toBeCloseTo(3, 9);
  });

  it('follows SPICE PULSE across edges and periods', () => {
    const w = parseWaveform('PULSE(0 5 1m 1m 1m 2m 10m)')!;
    expect(w(0)).toBe(0);
    expect(w(1.5e-3)).toBeCloseTo(2.5, 9);
    expect(w(3e-3)).toBe(5);
    expect(w(4.5e-3)).toBeCloseTo(2.5, 9);
    expect(w(8e-3)).toBe(0);
    expect(w(13e-3)).toBe(5);
  });

  it('reads DC specs and rejects unknown ones', () => {
    expect(parseWaveform('DC 5')!(1)).toBe(5);
    expect(parseWaveform('12')!(1)).toBe(12);
    expect(parseWaveform('foo(1)')).toBeNull();
    expect(parseWaveform('SIN(a b)')).toBeNull();
  });
});

describe('parseDiodeModel', () => {
  it('reads the DC parameters', () => {
    const p = parseDiodeModel('.model D D(IS=2.52n RS=0.568 N=1.752 BV=100)');
    expect(p.is).toBeCloseTo(2.52e-9, 15);
    expect(p.rs).toBeCloseTo(0.568, 9);
    expect(p.nvt).toBeCloseTo(1.752 * 0.025865, 9);
  });

  it('uses the SPICE defaults, without confusing similar names', () => {
    const p = parseDiodeModel('.model D D(IBV=1m)');
    expect(p.is).toBe(1e-14);
    expect(p.rs).toBe(0);
    expect(p.nvt).toBeCloseTo(0.025865, 9);
  });
});

describe('breakdown', () => {
  it('gives IBV at BV', () => {
    const model = '.model Z D(IS=1n N=1.5 BV=5.1 IBV=5m)';
    const { engine, compiled } = build([V('V1', 'a', '0', 'DC -5.1'), { def: 'zener', tag: 'D1', nets: ['a', '0'], props: { model: 'Z' } }], [{ name: 'Z', card: model }]);
    engine.initialize();
    const diode = compiled.devices.findIndex((d) => d.kind === 'diode');
    expect(engine.deviceCurrent(diode)).toBeCloseTo(-5e-3, 5);
  });

  it('has no breakdown without BV', () => {
    expect(parseDiodeModel('.model D D(IS=1n)').breakdown).toBeNull();
  });
});

describe('changing model while running', () => {
  const running = (parts: Part[], models: SpiceModel[]) => {
    const compiled = compileCircuit(Object.assign(circuitFromNets('t', parts), { models }));
    if (!compiled.ok) throw new Error(compiled.errors.join());
    return compiled.compiled;
  };

  const swap = (build: (model: string) => Part[], models: SpiceModel[], from: string, to: string) => {
    const first = new RealtimeEngine(running(build(from), models));
    first.initialize();
    const second = new RealtimeEngine(running(build(to), models));
    expect(second.compiled.signature).toBe(first.compiled.signature);
    second.adoptState(first);
    for (let i = 0; i < 20; i++) second.step(1e-5);
    return second;
  };

  const zener = (model: string): Part[] => [V('V1', 'a', '0', 'DC 12'), R('R1', 'a', 'z', '1k'), { def: 'zener', tag: 'D1', nets: ['0', 'z'], props: { model } }];
  const zeners = [
    { name: 'Z9', card: '.model Z9 D(IS=1n N=1.2 BV=9.1 IBV=20m)' },
    { name: 'Z5', card: '.model Z5 D(IS=1n N=1.2 BV=5.1 IBV=20m)' },
  ];

  it.each([
    ['Z9', 'Z5', 4.9, 5.2],
    ['Z5', 'Z9', 8.9, 9.2],
  ])('goes from %s to %s without stopping', (from, to, low, high) => {
    const engine = swap(zener, zeners, from, to);
    const output = engine.nodeVoltage(1);
    expect(output).toBeGreaterThan(low);
    expect(output).toBeLessThan(high);
  });

  it('does the same with a transistor whose saturation current jumps', () => {
    const stage = (model: string): Part[] => [V('V1', 'c', '0', 'DC 5'), V('V2', 'b', '0', 'DC 0.75'), { def: 'npn', tag: 'Q1', nets: ['c', 'b', '0'], props: { model } }];
    const models = [
      { name: 'A', card: '.model A NPN(IS=1f BF=100)' },
      { name: 'B', card: '.model B NPN(IS=1p BF=100)' },
    ];
    const engine = swap(stage, models, 'A', 'B');
    expect(engine.terminalCurrents(2)[0]).toBeGreaterThan(1);
  });

  it('keeps the charge of a capacitor across the change', () => {
    const withCap = (model: string): Part[] => [...zener(model), C('C1', 'k', '0', '1u')];
    const parts = withCap('Z9');
    const first = new RealtimeEngine(running(parts, zeners));
    first.initialize();
    const second = new RealtimeEngine(running(withCap('Z5'), zeners));
    second.adoptState(first);
    expect(second.time).toBe(first.time);
    expect([...second.x]).toEqual([...first.x]);
  });
});

describe('BJT', () => {
  const npn = (c: string, b: string, e: string, model = '.model T NPN(IS=1f BF=100)'): [Part, { name: string; card: string }[]] => [
    { def: 'npn', tag: 'Q1', nets: [c, b, e], props: { model: 'T' } },
    [{ name: 'T', card: model }],
  ];

  it('reads the parameters, with SPICE defaults and aliases', () => {
    const p = parseBjtModel('.model T NPN(IS=1f BF=200 VA=50 RB=10)', 1);
    expect(p.is).toBeCloseTo(1e-15, 20);
    expect(p.bf).toBe(200);
    expect(p.ovaf).toBeCloseTo(1 / 50, 12);
    expect(p.br).toBe(1);
    expect(p.ovar).toBe(0);
    expect(p.rb).toBe(10);
    expect(p.neVt).toBeCloseTo(1.5 * 0.025865, 9);
  });

  it('amplifies the base current by BF in the active region', () => {
    const [q, models] = npn('c', 'b', '0');
    const { engine, compiled } = build([V('VCC', 'c', '0', 'DC 5'), V('VB', 'in', '0', 'DC 5'), R('RB', 'in', 'b', '430k'), q], models);
    engine.initialize();
    const index = compiled.devices.findIndex((d) => d.kind === 'bjt');
    const [ic, ib, ie] = engine.terminalCurrents(index);
    expect(ib).toBeGreaterThan(9e-6);
    expect(ic / ib).toBeCloseTo(100, 1);
    expect(ic + ib + ie).toBeCloseTo(0, 12);
    expect(engine.deviceCurrent(index)).toBe(ic);
  });

  it('saturates: the collector stays near the emitter and the gain drops', () => {
    const [q, models] = npn('c', 'b', '0');
    const { engine, compiled, node } = build([V('VCC', 'vcc', '0', 'DC 5'), R('RC', 'vcc', 'c', '1k'), V('VB', 'in', '0', 'DC 5'), R('RB', 'in', 'b', '10k'), q], models);
    engine.initialize();
    expect(engine.nodeVoltage(node('q1', 'collector'))).toBeLessThan(0.2);
    const [ic, ib] = engine.terminalCurrents(compiled.devices.findIndex((d) => d.kind === 'bjt'));
    expect(ic / ib).toBeLessThan(20);
  });

  it('turns everything around for a PNP', () => {
    const { engine, compiled, node } = build(
      [V('VEE', 'e', '0', 'DC 5'), R('RB', 'b', '0', '430k'), { def: 'pnp', tag: 'Q1', nets: ['0', 'b', 'e'], props: { model: 'T' } }],
      [{ name: 'T', card: '.model T PNP(IS=1f BF=100)' }],
    );
    engine.initialize();
    const [ic, ib] = engine.terminalCurrents(compiled.devices.findIndex((d) => d.kind === 'bjt'));
    expect(ib).toBeLessThan(0);
    expect(ic / ib).toBeCloseTo(100, 1);
    expect(engine.nodeVoltage(node('q1', 'base'))).toBeGreaterThan(3.9);
  });

  it('feels the Early effect', () => {
    const current = (vcc: string) => {
      const [q, models] = npn('c', 'b', '0', '.model T NPN(IS=1f BF=100 VAF=50)');
      const { engine, compiled } = build([V('VCC', 'c', '0', `DC ${vcc}`), V('VB', 'in', '0', 'DC 5'), R('RB', 'in', 'b', '430k'), q], models);
      engine.initialize();
      return engine.terminalCurrents(compiled.devices.findIndex((d) => d.kind === 'bjt'))[0];
    };
    expect(current('20')).toBeGreaterThan(current('5') * 1.2);
  });

  it('refuses a model of the wrong kind', () => {
    const result = compileCircuit(circuitFromNets('t', [{ def: 'npn', tag: 'Q1', nets: ['c', 'b', '0'], props: { model: '2N3906' } }]));
    expect(result).toEqual({ ok: false, errors: ['Q1: il modello "2N3906" non è di tipo NPN'] });
  });

  it('survives open terminals, as a drawing in progress has', () => {
    const [q, models] = npn('c', 'b', 'e');
    const { engine } = build([V('V1', 'a', '0', 'DC 5'), R('R1', 'a', '0', '1k'), q], models);
    engine.initialize();
    expect(() => engine.step(1e-5)).not.toThrow();
  });
});

describe('MOSFET', () => {
  const nmos = (d: string, g: string, s: string, model = 'T'): Part => ({ def: 'nmos', tag: 'M1', nets: [d, g, s], props: { model } });
  const T = [{ name: 'T', card: '.model T NMOS(VTO=2 KP=0.5 LAMBDA=0.01)' }];
  const drainCurrent = (vg: string, vd: string, models = T, part = nmos('d', 'g', '0')) => {
    const { engine, compiled } = build([V('VD', 'd', '0', `DC ${vd}`), V('VG', 'g', '0', `DC ${vg}`), part], models);
    engine.initialize();
    return engine.terminalCurrents(compiled.devices.findIndex((x) => x.kind === 'mos'));
  };

  it('reads the parameters, with the defaults of each kind', () => {
    const level1 = parseMosModel('.model M NMOS(VTO=2 KP=20u)', 1);
    expect(level1).toMatchObject({ beta: 20e-6, vth: 2, subthreshold: 0, mtriode: 1, signedLambda: false, rb: 0 });
    expect(parseMosModel('.model M NMOS(VTO=2)', 1).beta).toBeCloseTo(2e-5, 12);
    expect(parseMosModel('.model M PMOS(VTO=-2)', -1).vth).toBe(2);
    const vdmos = parseMosModel('.model M VDMOS(VTO=2 RB=.1)', 1);
    expect(vdmos).toMatchObject({ beta: 1, subthreshold: 0.1, signedLambda: true, rb: 0.1 });
  });

  it('computes KP from the oxide when it is missing', () => {
    expect(parseMosModel('.model M NMOS(TOX=100n UO=600)', 1).beta).toBeCloseTo(600e-4 * (3.9 * 8.854214871e-12) / 100e-9, 10);
  });

  it('is off below the threshold', () => {
    expect(Math.abs(drainCurrent('1', '5')[0])).toBeLessThan(1e-9);
  });

  it('saturates with the square law', () => {
    expect(drainCurrent('3', '5')[0]).toBeCloseTo(0.25 * 1.05, 6);
  });

  it('follows the triode region at low drain voltage', () => {
    expect(drainCurrent('5', '0.5')[0]).toBeCloseTo(0.5 * 1.005 * 0.5 * 2.75, 6);
  });

  it('draws no gate current and returns the drain current from the source', () => {
    const [d, g, s] = drainCurrent('3', '5');
    expect(g).toBe(0);
    expect(s).toBe(-d);
  });

  it('exchanges drain and source when the drain goes below', () => {
    expect(drainCurrent('3', '-0.2')[0]).toBeCloseTo(-0.5 * 1.002 * 0.2 * 1.1, 6);
  });

  it('conducts through the body diode when off', () => {
    const models = [{ name: 'T', card: '.model T NMOS(VTO=2 KP=0.5)' }];
    const { engine, node } = build([V('V1', 'in', '0', 'DC -5'), R('R1', 'in', 'd', '1k'), nmos('d', '0', '0')], models);
    engine.initialize();
    expect(engine.nodeVoltage(node('r1', 'b'))).toBeCloseTo(-0.65, 0);
  });

  it('turns everything around for a P channel', () => {
    const models = [{ name: 'T', card: '.model T PMOS(VTO=-2 KP=0.5)' }];
    const part: Part = { def: 'pmos', tag: 'M1', nets: ['d', 'g', 's'], props: { model: 'T' } };
    const { engine, compiled } = build([V('VS', 's', '0', 'DC 5'), V('VG', 'g', '0', 'DC 2'), R('RD', 'd', '0', '1'), part], models);
    engine.initialize();
    const [id] = engine.terminalCurrents(compiled.devices.findIndex((x) => x.kind === 'mos'));
    expect(id).toBeLessThan(-0.1);
  });

  it('has a smooth threshold on a VDMOS, as ngspice', () => {
    const models = [{ name: 'T', card: '.model T VDMOS(VTO=2 KP=0.5 LAMBDA=0.01)' }];
    expect(drainCurrent('2', '5', models)[0]).toBeCloseTo(1.26119e-3, 7);
    expect(drainCurrent('2.2', '5', models)[0]).toBeCloseTo(1.1875e-2, 6);
    expect(drainCurrent('3', '5', models)[0]).toBeCloseTo(0.262502, 5);
    expect(drainCurrent('3', '-0.2', models)[0]).toBeCloseTo(-0.10978, 4);
  });

  it('refuses a model of the wrong kind', () => {
    expect(compileCircuit(circuitFromNets('t', [{ def: 'nmos', tag: 'M1', nets: ['d', 'g', '0'], props: { model: 'MP1' } }]))).toEqual({
      ok: false,
      errors: ['M1: il modello "MP1" non è di tipo NMOS'],
    });
  });
});

describe('ideal op amp', () => {
  const U = (minus: string, plus: string, out: string, high = '15', low = '-15'): Part => ({ def: 'opamp', tag: 'U1', nets: [minus, plus, out], props: { high, low } });
  const out = (node: (tag: string, terminal: string) => number, engine: RealtimeEngine) => engine.nodeVoltage(node('u1', 'out'));

  it('amplifies with the ratio of the resistors, with the inputs at the same voltage', () => {
    const { engine, node } = build([V('V1', 'in', '0', 'DC 1'), R('R1', 'in', 'n', '1k'), R('R2', 'n', 'o', '10k'), U('n', '0', 'o')]);
    engine.initialize();
    expect(out(node, engine)).toBeCloseTo(-10, 3);
    expect(engine.nodeVoltage(node('u1', 'minus'))).toBeCloseTo(0, 4);
  });

  it('follows as a buffer, supplying the load from its output', () => {
    const { engine, node, compiled } = build([V('V1', 'in', '0', 'DC 3'), U('o', 'in', 'o'), R('RL', 'o', '0', '1k')]);
    engine.initialize();
    expect(out(node, engine)).toBeCloseTo(3, 4);
    const u = compiled.devices.findIndex((d) => d.kind === 'opamp');
    expect(engine.terminalCurrents(u)).toEqual([expect.closeTo(-3e-3, 6), 0, 0]);
    expect(engine.deviceCurrent(u)).toBeCloseTo(-3e-3, 6);
  });

  it('stops at its rails, even uneven ones', () => {
    const circuit = (input: string) => [V('V1', 'in', '0', `DC ${input}`), R('R1', 'in', 'n', '1k'), R('R2', 'n', 'o', '10k'), U('n', '0', 'o', '12', '-5')];
    const high = build(circuit('-5'));
    high.engine.initialize();
    expect(out(high.node, high.engine)).toBe(12);
    const low = build(circuit('5'));
    low.engine.initialize();
    expect(out(low.node, low.engine)).toBe(-5);
  });

  it('compares when open, switching with the input', () => {
    const { engine, node } = build([V('V1', 'in', '0', 'SIN(0 1 100)'), U('0', 'in', 'o')]);
    engine.initialize();
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      engine.step(1e-5);
      seen.add(out(node, engine));
    }
    expect(seen.has(15)).toBe(true);
    expect(seen.has(-15)).toBe(true);
  });

  it('has hysteresis with positive feedback: switches at the thresholds, not at zero', () => {
    const { engine, node } = build([V('V1', 'in', '0', 'SIN(0 10 100)'), U('in', 'p', 'o'), R('R1', 'o', 'p', '10k'), R('R2', 'p', '0', '10k')]);
    engine.initialize();
    const switches: number[] = [];
    let last = NaN;
    for (let i = 0; i < 3000; i++) {
      engine.step(1e-5);
      const v = out(node, engine);
      expect(Math.abs(v)).toBe(15);
      if (!Number.isNaN(last) && v !== last) switches.push(10 * Math.sin(2 * Math.PI * 100 * engine.time));
      last = v;
    }
    expect(switches.length).toBeGreaterThan(3);
    for (const input of switches) expect(Math.abs(input)).toBeCloseTo(7.5, 0);
  });

  it('starts an oscillator, by itself and on the positive side', () => {
    const { engine, node } = build(RELAXATION_OSCILLATOR);
    engine.initialize();
    expect(out(node, engine)).toBeCloseTo(0, 3);
    expect(engine.unstableOpAmps()).toEqual(['u1']);
    engine.step(1e-5);
    expect(out(node, engine)).toBe(15);
  });

  it('has nothing unstable with negative feedback', () => {
    const { engine } = build([V('V1', 'in', '0', 'DC 1'), R('R1', 'in', 'n', '1k'), R('R2', 'n', 'o', '10k'), U('n', '0', 'o')]);
    engine.initialize();
    expect(engine.unstableOpAmps()).toEqual([]);
  });

  it('keeps its state when a value changes', () => {
    const parts = [V('V1', 'in', '0', 'DC 5'), U('in', 'p', 'o'), R('R1', 'o', 'p', '10k'), R('R2', 'p', '0', '10k')];
    const first = build(parts);
    first.engine.initialize();
    first.engine.step(1e-5);
    const compiled = compileCircuit(circuitFromNets('t', [parts[0], parts[1], R('R1', 'o', 'p', '11k'), parts[3]]));
    if (!compiled.ok) throw new Error();
    const next = new RealtimeEngine(compiled.compiled);
    expect(next.compiled.signature).toBe(first.engine.compiled.signature);
    next.adoptState(first.engine);
    next.step(1e-5);
    expect(next.nodeVoltage(first.node('u1', 'out'))).toBe(first.engine.nodeVoltage(first.node('u1', 'out')));
  });

  it.each([
    ['15', '15'],
    ['-15', '15'],
    ['abc', '-15'],
    ['', '-15'],
  ])('refuses the rails %j and %j', (high, low) => {
    expect(compileCircuit(circuitFromNets('t', [U('n', '0', 'o', high, low)]))).toEqual({ ok: false, errors: ['U1: alimentazioni non valide'] });
  });

  it('exchanges the inputs when mirrored, as the wires stay where they are', () => {
    const elements = (flip: boolean): Circuit => ({
      title: 't',
      models: [],
      elements: [
        { id: 'v1', def: 'vsource', x: -200, y: 0, rot: 90, tag: 'V1', props: { spec: 'DC 1' } },
        { id: 'g', def: 'ground', x: -200, y: 100, rot: 0, tag: '', props: {} },
        { id: 'r1', def: 'resistor', x: 100, y: 40, rot: 90, tag: 'R1', props: { value: '1k' } },
        { id: 'u1', def: 'opamp', x: 0, y: 0, rot: 0, flip, tag: 'U1', props: { high: '15', low: '-15' } },
      ],
      wires: [
        // Upper input to the source, lower input to ground, load on the output
        { id: 'a', pts: [{ x: -200, y: -40 }, { x: -40, y: -40 }, { x: -40, y: -10 }] },
        { id: 'b', pts: [{ x: -200, y: 40 }, { x: -200, y: 100 }, { x: -40, y: 100 }, { x: -40, y: 10 }] },
        { id: 'c', pts: [{ x: 40, y: 0 }, { x: 100, y: 0 }] },
        { id: 'd', pts: [{ x: 100, y: 80 }, { x: 100, y: 100 }, { x: -40, y: 100 }] },
      ],
    });
    const output = (flip: boolean) => {
      const circuit = elements(flip);
      const result = compileCircuit(circuit);
      if (!result.ok) throw new Error(result.errors.join());
      const engine = new RealtimeEngine(result.compiled);
      engine.initialize();
      const u = result.compiled.devices.find((d) => d.kind === 'opamp')!;
      return engine.nodeVoltage(u.a);
    };
    // The minus input is on top by default, with the source on it: the output goes to the low rail
    expect(output(false)).toBe(-15);
    expect(output(true)).toBe(15);
  });

  describe('with a GBW', () => {
    const limited = (gbw = '1meg'): Part => ({ def: 'opamp', tag: 'U1', nets: ['n', 'in', 'o'], props: { high: '15', low: '-15', gbw } });
    const amplifier = (input: string, gbw?: string) => [V('V1', 'in', '0', input), R('R1', 'n', '0', '100'), R('R2', 'n', 'o', '99.9k'), limited(gbw)];
    const amplitude = (f: number) => {
      const { engine, node } = build(amplifier(`SIN(0 1m ${f})`));
      engine.initialize();
      let peak = 0;
      const dt = 1 / f / 400;
      for (let i = 0; i < 8000; i++) {
        engine.step(dt);
        if (i > 4000) peak = Math.max(peak, Math.abs(engine.nodeVoltage(node('u1', 'out'))));
      }
      return peak / 1e-3;
    };

    it('keeps its gain inside the band', () => {
      expect(amplitude(10)).toBeCloseTo(1000, -1);
    });

    it('loses 3 dB at GBW over gain', () => {
      expect(amplitude(1000)).toBeCloseTo(1000 / Math.SQRT2, -1);
    });

    it('falls with frequency beyond it', () => {
      expect(amplitude(10000)).toBeCloseTo(100, -1);
    });

    it('settles at the same DC as the ideal one', () => {
      const { engine, node } = build(amplifier('DC 1m'));
      engine.initialize();
      expect(out(node, engine)).toBeCloseTo(1, 2);
    });

    it('comes back from saturation at once, without winding up', () => {
      const { engine, node } = build([V('V1', 'in', '0', 'PULSE(1 -1 10m 1u 1u 10m 40m)'), { ...limited(), nets: ['0', 'in', 'o'] }]);
      engine.initialize();
      for (let i = 0; i < 950; i++) engine.step(1e-5);
      expect(out(node, engine)).toBe(15);
      for (let i = 0; i < 100; i++) engine.step(1e-5);
      expect(out(node, engine)).toBe(-15);
    });

    it('refuses a GBW that makes no sense, and treats empty as ideal', () => {
      expect(compileCircuit(circuitFromNets('t', [limited('abc')]))).toEqual({ ok: false, errors: ['U1: GBW non valido "abc"'] });
      expect(compileCircuit(circuitFromNets('t', [limited('-5')]))).toEqual({ ok: false, errors: ['U1: GBW non valido "-5"'] });
      const ideal = compileCircuit(circuitFromNets('t', [limited('')]));
      if (!ideal.ok) throw new Error();
      expect(ideal.compiled.devices[0]).toMatchObject({ kind: 'opamp', tau: 0 });
    });
  });

  it('survives open inputs, as a drawing in progress has', () => {
    const { engine } = build([V('V1', 'a', '0', 'DC 5'), R('R1', 'a', '0', '1k'), U('n', 'p', 'o')]);
    engine.initialize();
    expect(() => engine.step(1e-5)).not.toThrow();
  });
});

describe('RealtimeEngine', () => {
  it('solves a divider, with the source current in SPICE sign', () => {
    const { engine, node, compiled } = build([V('V1', 'in', '0', 'DC 12'), R('R1', 'in', 'out', '1k'), R('R2', 'out', '0', '2k')]);
    engine.initialize();
    expect(engine.nodeVoltage(node('r2', 'a'))).toBeCloseTo(8, 6);
    const source = compiled.devices.findIndex((d) => d.kind === 'vsource');
    expect(engine.deviceCurrent(source)).toBeCloseTo(-4e-3, 8);
  });

  it('charges an RC towards the exact exponential', () => {
    const { engine, node } = build([V('V1', 'in', '0', 'PULSE(0 5 0 1n 1n 1 2)'), R('R1', 'in', 'out', '1k'), C('C1', 'out', '0', '1u')]);
    engine.initialize();
    for (let i = 0; i < 1000; i++) engine.step(1e-6);
    expect(engine.nodeVoltage(node('c1', 'a'))).toBeCloseTo(5 * (1 - Math.exp(-1)), 2);
  });

  it('builds current in an RL towards the exact exponential', () => {
    const { engine, compiled } = build([V('V1', 'in', '0', 'PULSE(0 5 0 1n 1n 1 2)'), R('R1', 'in', 'out', '100'), L('L1', 'out', '0', '100m')]);
    engine.initialize();
    for (let i = 0; i < 1000; i++) engine.step(1e-6);
    const inductor = compiled.devices.findIndex((d) => d.kind === 'inductor');
    expect(engine.deviceCurrent(inductor)).toBeCloseTo(0.05 * (1 - Math.exp(-1)), 3);
  });

  it('starts from the DC operating point: capacitor charged, inductor conducting', () => {
    const { engine, node, compiled } = build([V('V1', 'in', '0', 'DC 5'), R('R1', 'in', 'out', '100'), L('L1', 'out', 'c', '1m'), C('C1', 'c', '0', '1u'), R('R2', 'c', '0', '100')]);
    engine.initialize();
    expect(engine.nodeVoltage(node('c1', 'a'))).toBeCloseTo(2.5, 6);
    const inductor = compiled.devices.findIndex((d) => d.kind === 'inductor');
    expect(engine.deviceCurrent(inductor)).toBeCloseTo(0.025, 8);
  });

  it('keeps the capacitor charge when a value changes while running', () => {
    const parts = [V('V1', 'in', '0', 'DC 5'), R('R1', 'in', 'out', '1k'), C('C1', 'out', '0', '1u')];
    const { engine, node } = build(parts);
    engine.initialize();
    const before = engine.nodeVoltage(node('c1', 'a'));

    const changed = compileCircuit(circuitFromNets('t', [parts[0], R('R1', 'in', 'out', '10k'), parts[2]]));
    if (!changed.ok) throw new Error();
    expect(changed.compiled.signature).toBe(engine.compiled.signature);
    const next = new RealtimeEngine(changed.compiled);
    next.adoptState(engine);
    next.step(1e-6);
    expect(next.nodeVoltage(node('c1', 'a'))).toBeCloseTo(before, 3);
    expect(next.time).toBeCloseTo(1e-6, 12);
  });

  it('changes signature when the topology changes', () => {
    const a = compileCircuit(circuitFromNets('t', [V('V1', 'in', '0', 'DC 5'), R('R1', 'in', '0', '1k')]));
    const b = compileCircuit(circuitFromNets('t', [V('V1', 'in', '0', 'DC 5'), R('R1', 'in', 'x', '1k'), R('R2', 'x', '0', '1k')]));
    if (!a.ok || !b.ok) throw new Error();
    expect(a.compiled.signature).not.toBe(b.compiled.signature);
  });

  it('survives a node left unconnected', () => {
    const { engine, node } = build([V('V1', 'in', '0', 'DC 5'), R('R1', 'in', 'open', '1k'), C('C1', 'open2', '0', '1u')]);
    engine.initialize();
    expect(engine.nodeVoltage(node('r1', 'b'))).toBeCloseTo(5, 3);
    expect(() => engine.step(1e-6)).not.toThrow();
  });

  it('reports two sources shorted together instead of producing NaN', () => {
    const { engine } = build([V('V1', 'a', '0', 'DC 5'), V('V2', 'a', '0', 'DC 3'), R('R1', 'a', '0', '1k')]);
    expect(() => engine.initialize()).toThrow(SolverError);
  });

  it('asks for a ground', () => {
    const circuit = circuitFromNets('t', [R('R1', 'a', '0', '1k')]);
    circuit.elements = circuit.elements.filter((e) => e.def !== 'ground');
    expect(compileCircuit(circuit)).toEqual({ ok: false, errors: ['Il circuito non ha una massa'] });
  });

  it('collects invalid values', () => {
    const result = compileCircuit(circuitFromNets('t', [R('R1', 'a', '0', 'abc'), V('V1', 'a', '0', 'boh')]));
    expect(result).toEqual({ ok: false, errors: ['R1: valore non valido "abc"', 'V1: sorgente non valida "boh"'] });
  });
});
