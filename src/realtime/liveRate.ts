import { Circuit } from '../model/types';
import { getDevice } from '../library/devices';
import { sourceSpec } from '../netlist/source';
import { waveformStats } from './waveform';
import { parseSpiceValue } from '../netlist/values';
import { timerEstimate } from './timer555';

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

/** One simulated second each second: the speed of a circuit with an Arduino. */
export const REAL_TIME = 1;

/** The speed for slow circuits, and the fastest the automatic choice takes: one period of 50 Hz in a second, easy to follow by eye. */
export const DEFAULT_SPEED = 20e-3;

/** Points of the oscilloscope per period for a square wave to look square. */
export const GOOD_SAMPLES_PER_PERIOD = 40;
/** Below this the trace no longer shows the signal: corners, then frequencies that are not there. */
export const MIN_SAMPLES_PER_PERIOD = 20;

/** The frequency of each periodic generator: the signal sources, the logic clocks and the 555 timers. */
export function generatorFrequencies(circuit: Circuit): number[] {
  const frequencies: number[] = [];
  for (const el of circuit.elements) {
    const spice = getDevice(el.def)?.spice;
    let frequency: number | null | undefined = null;
    if (spice?.kind === 'vsource') {
      const spec = sourceSpec(el.props);
      frequency = spec ? waveformStats(spec)?.frequency : null;
    } else if (spice?.kind === 'logic' && spice.gate === 'clock') {
      frequency = parseSpiceValue(String(el.props.frequency ?? ''));
    } else if (spice?.kind === 'timer') {
      // A 555 in the circuits of the books: the frequency of an astable; a monostable counts as one
      // period per pulse, so that its pulse lasts about as long on the screen as on the bench
      const estimate = timerEstimate(circuit, el);
      frequency = estimate?.kind === 'astable' ? estimate.frequency : estimate ? 1 / estimate.duration : null;
    }
    if (frequency && frequency > 0) frequencies.push(frequency);
  }
  return frequencies;
}

/** The period of the fastest signal generator, or null with none. */
export function fastestPeriod(circuit: Circuit): number | null {
  const frequencies = generatorFrequencies(circuit);
  return frequencies.length > 0 ? 1 / Math.max(...frequencies) : null;
}

/** How many solver steps, and so points of the oscilloscope, fall in one period at a speed. */
export const samplesPerPeriod = (period: number, speed: number) => (period * LIVE_STEPS_PER_SECOND) / speed;

/**
 * The fastest listed speed that still gives the fastest signal enough points, and no faster than one
 * of its periods a second. Never slower than the default, which is one period of 50 Hz a second: a slow
 * clock of 1 Hz runs in real time, a circuit without generators keeps the speed it has always had.
 */
export function automaticSpeed(period: number | null, hasProgram = false): number {
  // A sketch counts real seconds, with millis and delay: it runs as on the bench
  if (hasProgram) return REAL_TIME;
  if (period === null) return DEFAULT_SPEED;
  const wanted = Math.min(Math.max(DEFAULT_SPEED, period), (period * LIVE_STEPS_PER_SECOND) / GOOD_SAMPLES_PER_PERIOD);
  const fitting = SPEEDS.filter((s) => s.simSecondsPerSecond <= wanted * (1 + 1e-9));
  return fitting.length > 0 ? fitting[fitting.length - 1].simSecondsPerSecond : SPEEDS[0].simSecondsPerSecond;
}

export const speedLabel = (speed: number) => SPEEDS.find((s) => s.simSecondsPerSecond === speed)?.label ?? `${speed} s/s`;
