import { describe, expect, it } from 'vitest';
import { getDevice } from '../library/devices';
import { Circuit } from '../model/types';
import { EXAMPLES } from '../samples/examples';
import { compileCircuit } from './compile';
import { LiveSimulation, MCU_MAX_STEP } from './liveSimulation';
import { hasMean, isVarying, VARYING_FLOOR } from './rms';
import { circuitFromNets, Part } from './testCircuits';

const SINE = { offset: '0', frequency: '50', phase: '0', duty: '50', rint: '0', spec: '' };

/** Runs a circuit for a while at the given step, and gives the frame and the index of a device. */
function run(c: Circuit, seconds: number, h: number) {
  const compiled = compileCircuit(c);
  if (!compiled.ok) throw new Error(compiled.errors.join());
  const sim = new LiveSimulation();
  expect(sim.load(c)).toEqual({ ok: true });
  sim.advance(Math.round(seconds / h), h, 1e6);
  return { frame: sim.frame()!, index: (id: string) => compiled.compiled.elementIds.indexOf(id) };
}

describe('RMS and mean over whole periods', () => {
  it('a sine of 325 V on 100 Ω: 230 V eff and 2.3 A eff, no mean, varying', () => {
    const c = circuitFromNets('t', [
      { def: 'vsource', tag: 'V1', nets: ['p', '0'], props: { ...SINE, shape: 'sin', amplitude: '325.27' } },
      { def: 'resistor', tag: 'R1', nets: ['p', '0'], props: { value: '100' } },
    ]);
    const { frame, index } = run(c, 0.2, 1e-4);
    const r = index('r1');
    expect(frame.deviceVoltageRms[r]).toBeCloseTo(230, 0);
    expect(frame.deviceCurrentRms[r]).toBeCloseTo(2.3, 2);
    expect(Math.abs(frame.deviceVoltageMean[r])).toBeLessThan(1);
    expect(isVarying(frame.deviceVoltageMean[r], frame.deviceVoltageRms[r], VARYING_FLOOR.V)).toBe(true);
    expect(hasMean(frame.deviceVoltageMean[r], frame.deviceVoltageRms[r], VARYING_FLOOR.V)).toBe(false);
  });

  it('a steady divider does not vary: its values are read as they are', () => {
    const c = circuitFromNets('t', [
      { def: 'dcsupply', tag: 'V1', nets: ['p', '0'], props: { shape: 'dc', amplitude: '12', rint: '0' } },
      { def: 'resistor', tag: 'R1', nets: ['p', 'm'], props: { value: '1k' } },
      { def: 'resistor', tag: 'R2', nets: ['m', '0'], props: { value: '1k' } },
    ]);
    const { frame, index } = run(c, 0.2, 1e-4);
    const r = index('r2');
    expect(isVarying(frame.deviceVoltageMean[r], frame.deviceVoltageRms[r], VARYING_FLOOR.V)).toBe(false);
    expect(frame.deviceVoltageMean[r]).toBeCloseTo(6, 6);
  });

  it('a PWM of Arduino at half on a resistor: RMS 5·√½, mean 2.5 V', () => {
    // The potentiometer program: A0 at half the supply gives a PWM of 127 on D9
    const ids = getDevice('arduino_uno')!.terminals.map((t) => t.id);
    const net: Record<string, string> = { '5V': 'vcc', GND: '0', A0: 'a0', D9: 'd9' };
    const c = circuitFromNets('t', [
      { def: 'arduino_uno', tag: 'A1', nets: ids.map((id) => net[id] ?? `nc_${id}`), props: { sketch: 'potenziometro', hex: '', hexName: '', resets: '0' } },
      { def: 'resistor', tag: 'RA', nets: ['vcc', 'a0'], props: { value: '10k' } },
      { def: 'resistor', tag: 'RB', nets: ['a0', '0'], props: { value: '10k' } },
      { def: 'resistor', tag: 'RL', nets: ['d9', '0'], props: { value: '10k' } },
    ] as unknown as Part[]);
    const { frame, index } = run(c, 0.5, 1 / 2400);
    const r = index('rl');
    const share = 127 / 255;
    expect(frame.deviceVoltageRms[r]).toBeCloseTo(5 * Math.sqrt(share), 1);
    expect(frame.deviceVoltageMean[r]).toBeCloseTo(5 * share, 1);
    expect(isVarying(frame.deviceVoltageMean[r], frame.deviceVoltageRms[r], VARYING_FLOOR.V)).toBe(true);
    expect(hasMean(frame.deviceVoltageMean[r], frame.deviceVoltageRms[r], VARYING_FLOOR.V)).toBe(true);
  });

  it('in real time the PWM is cut fine: pulses of the same width, as the oscilloscope must show them', () => {
    const ids = getDevice('arduino_uno')!.terminals.map((t) => t.id);
    const net: Record<string, string> = { '5V': 'vcc', GND: '0', A0: 'a0', D9: 'd9' };
    const c = circuitFromNets('t', [
      { def: 'arduino_uno', tag: 'A1', nets: ids.map((id) => net[id] ?? `nc_${id}`), props: { sketch: 'potenziometro', hex: '', hexName: '', resets: '0' } },
      { def: 'resistor', tag: 'RA', nets: ['vcc', 'a0'], props: { value: '10k' } },
      { def: 'resistor', tag: 'RB', nets: ['a0', '0'], props: { value: '10k' } },
      { def: 'resistor', tag: 'RL', nets: ['d9', '0'], props: { value: '10k' } },
    ] as unknown as Part[]);
    const sim = new LiveSimulation();
    expect(sim.load(c)).toEqual({ ok: true });
    sim.advance(240, 1 / 2400, 1e6);
    sim.setProbes([{ id: 'p', kind: 'voltage', elementId: 'rl' }], 1);
    sim.frame();
    sim.advance(240, 1 / 2400, 1e6);
    const { time, values } = sim.frame()!.scope!;
    expect(time[1] - time[0]).toBeLessThanOrEqual(MCU_MAX_STEP);
    // Widths of the pulses, between the crossings of half the swing
    const [rises, falls]: number[][] = [[], []];
    for (let i = 1; i < time.length; i++) {
      if (values[0][i - 1] < 2.5 && values[0][i] >= 2.5) rises.push(time[i]);
      if (values[0][i - 1] >= 2.5 && values[0][i] < 2.5 && rises.length > 0) falls.push(time[i]);
    }
    const widths = falls.map((t, k) => t - rises[k]);
    expect(widths.length).toBeGreaterThan(30);
    const period = 1 / 490.2;
    for (const w of widths) expect(Math.abs(w - (127 / 255) * period)).toBeLessThan(1.5 * MCU_MAX_STEP);
  });

  it('the half-wave rectifier: its load has a mean and an RMS, both worth reading', () => {
    const c = EXAMPLES.find((e) => e.id === 'rectifier')!.build();
    const { frame } = run(c, 0.3, 1e-4);
    const varying = frame.deviceVoltageRms.some((rms, i) => isVarying(frame.deviceVoltageMean[i], rms, VARYING_FLOOR.V) && hasMean(frame.deviceVoltageMean[i], rms, VARYING_FLOOR.V));
    expect(varying).toBe(true);
  });
});
