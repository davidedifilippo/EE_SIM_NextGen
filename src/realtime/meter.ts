import { getDevice } from '../library/devices';
import { Circuit } from '../model/types';
import { sourceSpec } from '../netlist/source';
import { waveformStats } from './waveform';

import { METER_MODES } from './meterModes';

export { METER_MODES } from './meterModes';

const VOLTMETER_RESISTANCE = 1e9;
const AMMETER_RESISTANCE = 1e-3;

const modeOf = (mode: unknown) => METER_MODES.find((m) => m.value === mode);

/** What the instrument is in the circuit, in both engines; null for a mode it does not have. */
export function meterResistance(mode: unknown): number | null {
  const found = modeOf(mode);
  return found ? (found.unit === 'V' ? VOLTMETER_RESISTANCE : AMMETER_RESISTANCE) : null;
}

/** Period of the slowest generator: a mean or an RMS is only right over whole periods. Null if none is periodic. */
export function slowestPeriod(circuit: Circuit): number | null {
  let period: number | null = null;
  for (const el of circuit.elements) {
    if (getDevice(el.def)?.spice.kind !== 'vsource') continue;
    const spec = sourceSpec(el.props);
    const frequency = spec ? waveformStats(spec)?.frequency : null;
    if (frequency && frequency > 0 && (period === null || 1 / frequency > period)) period = 1 / frequency;
  }
  return period;
}

/** At the 2400 steps per second of the animation, a tenth of a second: a reading must not change faster than it can be read. */
const MIN_STEPS_PER_READING = 240;

/** How long one reading lasts: whole periods, however fast the animation runs. */
export function readingWindow(period: number | null, h: number): number {
  const shortest = MIN_STEPS_PER_READING * h;
  return period === null ? shortest : period * Math.ceil(shortest / period - 1e-9);
}

export interface MeterReading {
  mean: number;
  /** RMS of what is left without the mean, as a laboratory meter reads alternating signals. */
  ac: number;
}

/** Averages a signal over windows, and holds the last complete one as a real display does. */
export class MeterWindow {
  private sum = 0;
  private squares = 0;
  private elapsed = 0;
  private complete: MeterReading | null = null;

  add(value: number, h: number, window: number) {
    this.sum += value * h;
    this.squares += value * value * h;
    this.elapsed += h;
    if (this.elapsed < window - h / 2) return;
    this.complete = this.partial();
    [this.sum, this.squares, this.elapsed] = [0, 0, 0];
  }

  private partial(): MeterReading {
    const mean = this.sum / this.elapsed;
    return { mean, ac: Math.sqrt(Math.max(0, this.squares / this.elapsed - mean * mean)) };
  }

  /** Until the first window ends, what there is so far. Null before any step. */
  get reading(): MeterReading | null {
    return this.complete ?? (this.elapsed > 0 ? this.partial() : null);
  }

  /** The circuit changed: the display holds its value until a window of the new one is complete. */
  restart() {
    [this.sum, this.squares, this.elapsed] = [0, 0, 0];
  }
}

/** Below these a reading is the noise of the calculation, not a measure. */
const FLOOR = { V: 1e-6, A: 1e-9 };

/** The value on the display, in the unit of the mode. Zero when it is what is left of a whole period. */
export function meterValue(mode: unknown, { mean, ac }: MeterReading): number {
  const found = modeOf(mode);
  if (!found) return NaN;
  const value = found.value === 'vdc' || found.value === 'adc' ? (Math.abs(mean) < 1e-3 * ac ? 0 : mean) : ac;
  return Math.abs(value) < FLOOR[found.unit] ? 0 : value;
}
