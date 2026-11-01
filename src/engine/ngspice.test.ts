import { describe, expect, it } from 'vitest';
import { generateNetlist } from '../netlist/generate';
import { D1N4148_PARAMS, halfWaveRectifier, RectifierOptions } from '../samples/halfWaveRectifier';
import { runTransient } from './ngspice';

const V_PEAK = 10;
const R_LOAD = 1000;
const PERIOD = 0.02;
const THERMAL_VOLTAGE = 0.02585;

/** Output peak with a resistive load, solving the Shockley equation by bisection. */
function expectedResistivePeak(): number {
  const { IS, RS, N } = D1N4148_PARAMS;
  const sourceVoltageFor = (vOut: number) => {
    const i = vOut / R_LOAD;
    return vOut + N * THERMAL_VOLTAGE * Math.log(i / IS + 1) + i * RS;
  };
  let [low, high] = [0, V_PEAK];
  for (let i = 0; i < 60; i++) {
    const mid = (low + high) / 2;
    if (sourceVoltageFor(mid) < V_PEAK) low = mid;
    else high = mid;
  }
  return low;
}

/** Simulates 5 periods and returns the output over the last 2, once the startup has settled. */
async function simulateOutput(opts: RectifierOptions) {
  const circuit = halfWaveRectifier(opts);
  const { text, errors, nodeOf } = generateNetlist(circuit, { type: 'tran', step: '20u', stop: '100m', maxStep: '20u' });
  expect(errors).toEqual([]);

  const { time, voltages } = await runTransient(text);
  const output = voltages.get(nodeOf.get('r1:a')!);
  if (!output) throw new Error(`Nodo di uscita assente: ${[...voltages.keys()].join(', ')}`);

  const start = time.findIndex((t) => t >= 5 * PERIOD - 2 * PERIOD);
  return { time: time.slice(start), output: output.slice(start) };
}

function average(time: number[], values: number[]): number {
  let area = 0;
  for (let i = 1; i < time.length; i++) area += ((values[i] + values[i - 1]) / 2) * (time[i] - time[i - 1]);
  return area / (time[time.length - 1] - time[0]);
}

describe('half-wave rectifier on ngspice', () => {
  it('matches the analytical values with a resistive load', async () => {
    const { time, output } = await simulateOutput({});
    expect(Math.max(...output)).toBeCloseTo(expectedResistivePeak(), 1);
    expect(Math.min(...output)).toBeGreaterThan(-0.01);
    expect(Math.abs(average(time, output) - expectedResistivePeak() / Math.PI)).toBeLessThan(0.15);
  }, 120_000);

  it('smooths the output with a filter capacitor', async () => {
    const { output } = await simulateOutput({ capacitor: '100u' });
    const peak = Math.max(...output);
    // Capacitor discharging through the load for almost a whole period.
    const expectedRipple = peak * (1 - Math.exp(-PERIOD / (R_LOAD * 100e-6)));
    expect(peak).toBeGreaterThan(9);
    expect(peak).toBeLessThan(9.6);
    expect(Math.abs(peak - Math.min(...output) - expectedRipple)).toBeLessThan(0.25);
  }, 120_000);

  it('inverts the output when the diode is reversed', async () => {
    const { output } = await simulateOutput({ reversed: true });
    expect(Math.min(...output)).toBeCloseTo(-expectedResistivePeak(), 1);
    expect(Math.max(...output)).toBeLessThan(0.01);
  }, 120_000);
});
