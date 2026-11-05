import { describe, expect, it } from 'vitest';
import { generateNetlist } from '../netlist/generate';
import { compileCircuit } from '../realtime/compile';
import { RealtimeEngine } from '../realtime/engine';
import { emptyCircuit, EXAMPLES } from './examples';

const example = (id: string) => EXAMPLES.find((e) => e.id === id)!.build();

/** The engine at its operating point, and the current into the first terminal of a part. */
function start(id: string) {
  const compiled = compileCircuit(example(id));
  if (!compiled.ok) throw new Error(compiled.errors.join('; '));
  const engine = new RealtimeEngine(compiled.compiled);
  engine.initialize();
  const current = (elementId: string) => engine.terminalCurrents(compiled.compiled.elementIds.indexOf(elementId))[0];
  return { engine, current };
}

describe('the examples', () => {
  it.each(EXAMPLES.map((e) => e.id))('%s is complete for both engines', (id) => {
    const circuit = example(id);
    expect(compileCircuit(circuit)).toMatchObject({ ok: true });
    // A program runs only in the animation: the precise analysis says so
    const isProgram = circuit.elements.some((el) => el.def === 'arduino_uno');
    const { errors } = generateNetlist(circuit, { type: 'tran', step: '20u', stop: '10m', maxStep: '20u' });
    if (isProgram) expect(errors).toEqual(["A1: un Arduino si simula solo nell'animazione: l'Analisi precisa non esegue il programma"]);
    else expect(errors).toEqual([]);
    expect(new Set(circuit.elements.map((el) => el.id)).size).toBe(circuit.elements.length);
  });

  it('divider: 12 V over 14.7k', () => {
    const { current } = start('divider');
    expect(Math.abs(current('r2')) * 4.7e3).toBeCloseTo((12 * 4.7) / 14.7, 3);
  });

  it('zener: the load holds near 5.1 V', () => {
    const { current } = start('zener');
    expect(Math.abs(current('rl')) * 1e3).toBeGreaterThan(4.8);
    expect(Math.abs(current('rl')) * 1e3).toBeLessThan(5.4);
  });

  it('regulator: 5 V on 100 ohms', () => {
    const { current } = start('regulator');
    expect(Math.abs(current('rl')) * 100).toBeCloseTo(5, 1);
  });

  it('inverting amplifier: 5 V peak on the load, against the input', () => {
    const { engine, current } = start('inverting');
    let [high, low] = [0, 0];
    for (let k = 0; k < 2000; k++) {
      engine.step(1e-6);
      // Current from the output into the load, so the sign is that of the output voltage
      const out = -current('rl') * 10e3;
      [high, low] = [Math.max(high, out), Math.min(low, out)];
    }
    expect(high).toBeCloseTo(5, 1);
    expect(low).toBeCloseTo(-5, 1);
  });

  it('gates: with 1 and 0 the XOR lights its LED, the AND does not', () => {
    const { current } = start('gates');
    expect(Math.abs(current('d1'))).toBeLessThan(1e-6);
    expect(current('d2')).toBeGreaterThan(5e-3);
  });

  it('switches: the LED lights only with the toggle closed and the button held', () => {
    const led = (closed: string, pressed: string) => {
      const circuit = example('switches');
      circuit.elements = circuit.elements.map((el) => (el.id === 's1' ? { ...el, props: { ...el.props, closed } } : el.id === 's2' ? { ...el, props: { ...el.props, pressed } } : el));
      const compiled = compileCircuit(circuit);
      if (!compiled.ok) throw new Error(compiled.errors.join());
      const engine = new RealtimeEngine(compiled.compiled);
      engine.initialize();
      return engine.deviceCurrent(compiled.compiled.elementIds.indexOf('d1'));
    };
    expect(led('0', '0')).toBeLessThan(1e-6);
    expect(led('1', '0')).toBeLessThan(1e-6);
    expect(led('0', '1')).toBeLessThan(1e-6);
    expect(led('1', '1')).toBeGreaterThan(5e-3);
  });

  it('full adder: 1 + 0 + 1 gives sum 0 and carry 1', () => {
    const { engine, current } = start('fulladder');
    engine.step(1e-6);
    expect(Math.abs(current('d1'))).toBeLessThan(1e-6);
    expect(current('d2')).toBeGreaterThan(5e-3);
  });

  it('multiplexer: S1 S0 choose which input reaches the LED', () => {
    const led = (s0: string) => {
      const circuit = example('mux');
      circuit.elements = circuit.elements.map((el) => (el.tag === 'S0' ? { ...el, props: { ...el.props, state: s0 } } : el));
      const compiled = compileCircuit(circuit);
      if (!compiled.ok) throw new Error(compiled.errors.join());
      const engine = new RealtimeEngine(compiled.compiled);
      engine.initialize();
      engine.step(1e-6);
      return engine.deviceCurrent(compiled.compiled.elementIds.indexOf('d1'));
    };
    // D0 is 1, D1 is 0
    expect(led('0')).toBeGreaterThan(5e-3);
    expect(Math.abs(led('1'))).toBeLessThan(1e-6);
  });

  it('seven segments: 0101 lights the segments of a 5', () => {
    const circuit = example('sevenseg');
    const compiled = compileCircuit(circuit);
    if (!compiled.ok) throw new Error(compiled.errors.join());
    const engine = new RealtimeEngine(compiled.compiled);
    engine.initialize();
    const lit = engine.terminalCurrents(compiled.compiled.elementIds.indexOf('ds1')).slice(0, 7).map((i) => (i > 1e-3 ? '1' : '0')).join('');
    expect(lit).toBe('1011011');
  });

  it('transistor switch: the collector conducts only while the base is driven', () => {
    const { engine, current } = start('switch');
    const collector = () => Math.abs(current('rc'));
    engine.step(0.25);
    const on = collector();
    engine.step(0.5);
    const off = collector();
    expect(on).toBeGreaterThan(10e-3);
    expect(off).toBeLessThan(1e-6);
  });
});

describe('a new circuit', () => {
  it('starts with a ground, so that a first part can already run', () => {
    const circuit = emptyCircuit();
    expect(circuit.elements.map((el) => el.def)).toEqual(['ground']);
    expect(compileCircuit(circuit)).toMatchObject({ ok: true });
  });
});
