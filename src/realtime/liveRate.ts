import { Circuit } from '../model/types';
import { getDevice } from '../library/devices';
import { sourceSpec } from '../netlist/source';
import { waveformStats } from './waveform';

/** Solver steps per second of real time: the step size follows from the chosen speed. */
export const LIVE_STEPS_PER_SECOND = 2400;

/** Simulated time per second of real time, from the slowest to the fastest. */
export const SPEEDS: { label: string; simSecondsPerSecond: number }[] = [
  { label: '10 µs/s', simSecondsPerSecond: 10e-6 },
  { label: '100 µs/s', simSecondsPerSecond: 100e-6 },
  { label: '1 ms/s', simSecondsPerSecond: 1e-3 },
  { label: '5 ms/s', simSecondsPerSecond: 5e-3 },
  { label: '20 ms/s', simSecondsPerSecond: 20e-3 },
  { label: '100 ms/s', simSecondsPerSecond: 100e-3 },
  { label: '1 s/s', simSecondsPerSecond: 1 },
];

/** The speed for slow circuits, and the fastest the automatic choice takes: one period of 50 Hz in a second, easy to follow by eye. */
export const DEFAULT_SPEED = 20e-3;

/** Points of the oscilloscope per period for a square wave to look square. */
export const GOOD_SAMPLES_PER_PERIOD = 40;
/** Below this the trace no longer shows the signal: corners, then frequencies that are not there. */
export const MIN_SAMPLES_PER_PERIOD = 20;

/** The period of the fastest signal generator, or null with none. */
export function fastestPeriod(circuit: Circuit): number | null {
  let period: number | null = null;
  for (const el of circuit.elements) {
    if (getDevice(el.def)?.spice.kind !== 'vsource') continue;
    const spec = sourceSpec(el.props);
    const frequency = spec ? waveformStats(spec)?.frequency : null;
    if (frequency && frequency > 0 && (period === null || 1 / frequency < period)) period = 1 / frequency;
  }
  return period;
}

/** How many solver steps, and so points of the oscilloscope, fall in one period at a speed. */
export const samplesPerPeriod = (period: number, speed: number) => (period * LIVE_STEPS_PER_SECOND) / speed;

/**
 * The fastest listed speed that still gives the fastest signal enough points, and never faster than
 * the default: a slow circuit keeps the speed it has always had.
 */
export function automaticSpeed(period: number | null): number {
  if (period === null) return DEFAULT_SPEED;
  const wanted = Math.min(DEFAULT_SPEED, (period * LIVE_STEPS_PER_SECOND) / GOOD_SAMPLES_PER_PERIOD);
  const fitting = SPEEDS.filter((s) => s.simSecondsPerSecond <= wanted * (1 + 1e-9));
  return fitting.length > 0 ? fitting[fitting.length - 1].simSecondsPerSecond : SPEEDS[0].simSecondsPerSecond;
}

export const speedLabel = (speed: number) => SPEEDS.find((s) => s.simSecondsPerSecond === speed)?.label ?? `${speed} s/s`;
