import { describe, expect, it } from 'vitest';
import { runTransient } from '../engine/ngspice';
import { getDevice } from '../library/devices';
import { Circuit, Element, Rotation, Wire } from '../model/types';
import { terminalKey } from '../netlist/connectivity';
import { generateNetlist } from '../netlist/generate';
import { compileCircuit } from './compile';
import { RealtimeEngine } from './engine';
import { buildLiveLayout, LiveSimulation } from './liveSimulation';
import { stepRelaySpec } from './stepRelay';
import { EXAMPLES } from '../samples/examples';

const part = (id: string, def: string, x: number, y: number, rot: Rotation, tag: string, props: Record<string, string> = {}): Element => ({
  id,
  def,
  x,
  y,
  rot,
  tag,
  props: { ...Object.fromEntries((getDevice(def)?.props ?? []).map((p) => [p.key, p.default])), ...props },
});
const wire = (id: string, ...pts: [number, number][]): Wire => ({ id, pts: pts.map(([x, y]) => ({ x, y })) });
const SOURCE = { offset: '0', frequency: '50', phase: '0', duty: '50', rint: '0', spec: '' };

/**
 * As the datasheet wires it: the phase on A1, a push button from A2 to the neutral, a lamp from 2 to the
 * neutral. K1 at (200, 40): A1 at (180, 0), A2 at (180, 80), 2 at (220, 80).
 */
function lampFromButton(volts = 325, coil = '230'): Circuit {
  return {
    title: 't',
    elements: [
      part('v1', 'vsource', 0, 40, 90, 'V1', { ...SOURCE, shape: 'sin', amplitude: String(volts) }),
      part('g', 'ground', 0, 80, 0, ''),
      part('k1', 'finder27_01', 200, 40, 0, 'K1', { coil }),
      part('s1', 'pushno', 180, 140, 90, 'S1'),
      part('lp1', 'lamp', 220, 140, 90, 'LP1', { power: '60', volts: '230' }),
    ],
    wires: [wire('w1', [0, 0], [180, 0]), wire('w2', [180, 80], [180, 100]), wire('w3', [220, 80], [220, 100]), wire('w4', [220, 180], [180, 180]), wire('w5', [180, 180], [0, 180], [0, 80])],
    models: [],
  };
}

/** Presses S1 for a while and lets it go, as a hand does; the lamp current RMS over the last 0.1 s after. */
function pressAndRead(sim: LiveSimulation, circuit: Circuit, lampIndex: number) {
  const pressed = (on: boolean): Circuit => ({ ...circuit, elements: circuit.elements.map((el) => (el.id === 's1' ? { ...el, props: { ...el.props, pressed: on ? '1' : '0' } } : el)) });
  expect(sim.load(pressed(true))).toEqual({ ok: true });
  sim.advance(2000, 1e-4, 1e6);
  expect(sim.load(pressed(false))).toEqual({ ok: true });
  sim.advance(2000, 1e-4, 1e6);
  let sum = 0;
  for (let k = 0; k < 1000; k++) {
    sim.advance(1, 1e-4, 1e6);
    sum += sim.frame()!.deviceCurrent[lampIndex] ** 2;
  }
  return Math.sqrt(sum / 1000);
}

const lampIndex = (c: Circuit) => {
  const compiled = compileCircuit(c);
  if (!compiled.ok) throw new Error(compiled.errors.join());
  return compiled.compiled.elementIds.indexOf('lp1');
};

describe('the Finder 27 against its datasheet', () => {
  it.each([
    ['230', 230, 0.0175],
    ['110', 110, 0.042],
  ])('the %s V coil takes its rated current at 50 Hz', (coil, volts, amps) => {
    const spec = stepRelaySpec('27.01', coil);
    // The resistance, then the inductance with the losses of the iron across it
    const x = 2 * Math.PI * 50 * spec.coilInductance;
    const d = spec.coilLoss ** 2 + x * x;
    const impedance = Math.hypot(spec.coilResistance + (spec.coilLoss * x * x) / d, (spec.coilLoss ** 2 * x) / d);
    expect(volts / impedance).toBeCloseTo(amps, 5);
  });

  it('27.01: each press of the button turns the lamp on, then off', () => {
    const c = lampFromButton();
    const sim = new LiveSimulation();
    const lamp = lampIndex(c);
    expect(sim.load(c)).toEqual({ ok: true });
    const first = pressAndRead(sim, c, lamp);
    const second = pressAndRead(sim, c, lamp);
    const third = pressAndRead(sim, c, lamp);
    // 60 W at 230 V: 0.26 A, once the filament is hot
    expect(first).toBeGreaterThan(0.2);
    expect(second).toBeLessThan(0.002);
    expect(third).toBeGreaterThan(0.2);
  });

  // Just below 0.8 it may still pull in: closing on an inductive coil, the first peaks of its current go beyond those of steady state
  it('pulls in from 0.8 of the rated voltage, not at 0.6', () => {
    const at = (share: number) => {
      const c = lampFromButton(230 * share * Math.SQRT2);
      const sim = new LiveSimulation();
      expect(sim.load(c)).toEqual({ ok: true });
      return pressAndRead(sim, c, lampIndex(c));
    };
    expect(at(0.6)).toBeLessThan(0.002);
    expect(at(0.85)).toBeGreaterThan(0.1);
  });
});

/**
 * A1 always at 12 V, which keeps the coil let go and lights nothing much, and at 242 V during each pulse;
 * a load of 1k on 2 and on 4. K1 at (200, 40): A1 (180, 0), A2 (180, 80), 2 (220, 80), 4 (240, 80).
 */
function pulsed(def: string): Circuit {
  const twoContacts = def !== 'finder27_01';
  return {
    title: 't',
    elements: [
      part('vd', 'dcsupply', 0, 40, 90, 'VD', { amplitude: '12' }),
      part('vp', 'vsource', 0, 140, 90, 'VP', { ...SOURCE, shape: 'custom', amplitude: '0', spec: 'PULSE(0 230 20m 1u 1u 30m 100m)' }),
      part('g', 'ground', 0, 180, 0, ''),
      part('k1', def, 200, 40, 0, 'K1'),
      part('r2', 'resistor', 220, 140, 90, 'R2', { value: '1k' }),
      ...(twoContacts ? [part('r4', 'resistor', 260, 140, 90, 'R4', { value: '1k' })] : []),
    ],
    wires: [
      wire('w1', [0, 0], [180, 0]),
      wire('w2', [0, 80], [0, 100]),
      wire('w3', [180, 80], [180, 180]),
      wire('w4', [220, 80], [220, 100]),
      ...(twoContacts ? [wire('w5', [240, 80], [260, 80], [260, 100])] : []),
      wire('w6', [twoContacts ? 260 : 220, 180], [0, 180]),
    ],
    models: [],
  };
}

/** Between the pulses, at 80, 180, 280 and 380 ms: whether each contact is closed, from the current of its load. */
const SAMPLES = [0.08, 0.18, 0.28, 0.38];

function contactsInEngine(c: Circuit): string[] {
  const compiled = compileCircuit(c);
  if (!compiled.ok) throw new Error(compiled.errors.join());
  const engine = new RealtimeEngine(compiled.compiled);
  engine.initialize();
  const loads = ['r2', 'r4'].map((id) => compiled.compiled.elementIds.indexOf(id)).filter((k) => k >= 0);
  return SAMPLES.map((t) => {
    while (engine.time < t - 5e-5) engine.step(1e-4);
    return loads.map((k) => (Math.abs(engine.deviceCurrent(k)) > 6e-3 ? '1' : '0')).join('');
  });
}

async function contactsInNgspice(c: Circuit): Promise<string[]> {
  const netlist = generateNetlist(c, { type: 'tran', step: '0.1m', stop: '400m', maxStep: '0.1m' });
  expect(netlist.errors).toEqual([]);
  const result = await runTransient(netlist.text);
  const loads = ['r2', 'r4'].filter((id) => c.elements.some((el) => el.id === id)).map((id) => result.voltages.get(netlist.nodeOf.get(terminalKey(id, 'a'))!)!);
  return SAMPLES.map((t) => {
    const k = result.time.findIndex((time) => time >= t);
    return loads.map((v) => (v[k] / 1000 > 6e-3 ? '1' : '0')).join('');
  });
}

describe('the sequences, in both engines', () => {
  it.each([
    ['finder27_01', ['1', '0', '1', '0']],
    ['finder27_05', ['01', '10', '11', '00']],
    ['finder27_06', ['01', '11', '00', '01']],
  ])('%s moves on at each pulse of the coil', async (def, expected) => {
    const c = pulsed(def);
    expect(contactsInEngine(c)).toEqual(expected);
    expect(await contactsInNgspice(c)).toEqual(expected);
  });
});

describe('the warnings', () => {
  it('says when the coil is beyond its range', () => {
    const c = lampFromButton(300 * Math.SQRT2);
    const compiled = compileCircuit({ ...c, elements: c.elements.map((el) => (el.id === 's1' ? { ...el, props: { ...el.props, pressed: '1' } } : el)) });
    if (!compiled.ok) throw new Error(compiled.errors.join());
    const engine = new RealtimeEngine(compiled.compiled);
    engine.initialize();
    for (let k = 0; k < 6000; k++) engine.step(1e-4);
    expect(engine.stepRelayStatus(compiled.compiled.elementIds.indexOf('k1'))!.warnings).toEqual(['Bobina oltre 253 V']);
  });
});

describe('the example', () => {
  it('lights the lamp with a press of any of the three buttons, and turns it off with the next', () => {
    const c = EXAMPLES.find((e) => e.id === 'steprelay')!.build();
    const sim = new LiveSimulation();
    expect(sim.load(c)).toEqual({ ok: true });
    const lamp = lampIndex(c);
    const press = (id: string) => {
      const withPressed = (on: boolean): Circuit => ({ ...c, elements: c.elements.map((el) => (el.id === id ? { ...el, props: { ...el.props, pressed: on ? '1' : '0' } } : el)) });
      expect(sim.load(withPressed(true))).toEqual({ ok: true });
      sim.advance(2000, 1e-4, 1e6);
      expect(sim.load(withPressed(false))).toEqual({ ok: true });
      sim.advance(3000, 1e-4, 1e6);
      let sum = 0;
      for (let k = 0; k < 400; k++) {
        sim.advance(1, 1e-4, 1e6);
        sum += sim.frame()!.deviceCurrent[lamp] ** 2;
      }
      // Opening the button does not count as an overvoltage on the coil
      expect(sim.frame()!.stepRelays.find((status) => status)!.warnings).toEqual([]);
      return Math.sqrt(sum / 400);
    };
    expect(press('s1')).toBeGreaterThan(0.2);
    expect(press('s3')).toBeLessThan(0.002);
    expect(press('s2')).toBeGreaterThan(0.2);
  });
});

describe('the lamp of the example', () => {
  it('reads no overvoltage when a button is pressed at the peak of the supply', () => {
    const c = EXAMPLES.find((e) => e.id === 'steprelay')!.build();
    const sim = new LiveSimulation();
    expect(sim.load(c)).toEqual({ ok: true });
    const lamp = lampIndex(c);
    const pressed = (id: string, on: boolean): Circuit => ({ ...c, elements: c.elements.map((el) => (el.id === id ? { ...el, props: { ...el.props, pressed: on ? '1' : '0' } } : el)) });
    // Lit and settled
    sim.load(pressed('s1', true));
    sim.advance(3000, 1e-4, 1e6);
    sim.load(pressed('s1', false));
    sim.advance(3000, 1e-4, 1e6);
    // Up to the peak of 325 V across the lamp, then a press of another button
    while (Math.abs(sim.frame()!.deviceVoltage[lamp]) < 320) sim.advance(1, 2e-5, 1e6);
    expect(sim.load(pressed('s2', true))).toEqual({ ok: true });
    sim.advance(1, 2e-5, 1e6);
    expect(sim.frame()!.lampRms[lamp]).toBeLessThan(240);
  });
});

describe('the animation', () => {
  it('runs the current of a contact along the rail and down the blade, never across', () => {
    const c = lampFromButton();
    const compiled = compileCircuit(c);
    if (!compiled.ok) throw new Error(compiled.errors.join());
    const layout = buildLiveLayout(c, compiled.compiled);
    const device = layout.devices[compiled.compiled.elementIds.indexOf('k1')];
    const contact = layout.dots[device.firstDot + 1];
    // K1 at (200, 40): A1 (180, 0), the rail at y 10, the contact to 2 at x 220
    const path = [contact.a, ...(contact.via ?? []), contact.b];
    expect(path).toEqual([
      { x: 180, y: 0 },
      { x: 180, y: 10 },
      { x: 220, y: 10 },
      { x: 220, y: 80 },
    ]);
  });
});
