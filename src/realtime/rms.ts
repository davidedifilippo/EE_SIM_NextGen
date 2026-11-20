/**
 * Mean and RMS of many signals at once, over windows of whole periods: what the values on the schematic and
 * in the properties show for alternating and PWM signals, where the instant says little. As the display of a
 * meter, each holds its last complete window.
 */
export class SignalWindows {
  private readonly sums: Float64Array;
  private readonly squares: Float64Array;
  private elapsed = 0;
  /** NaN until the first window is complete. */
  readonly mean: Float64Array;
  readonly rms: Float64Array;

  constructor(readonly count: number) {
    this.sums = new Float64Array(count);
    this.squares = new Float64Array(count);
    this.mean = new Float64Array(count).fill(NaN);
    this.rms = new Float64Array(count).fill(NaN);
  }

  add(values: ArrayLike<number>, h: number, window: number) {
    for (let k = 0; k < this.count; k++) {
      const v = values[k];
      this.sums[k] += v * h;
      this.squares[k] += v * v * h;
    }
    this.elapsed += h;
    if (this.elapsed < window - h / 2) return;
    for (let k = 0; k < this.count; k++) {
      this.mean[k] = this.sums[k] / this.elapsed;
      this.rms[k] = Math.sqrt(Math.max(0, this.squares[k] / this.elapsed));
    }
    this.sums.fill(0);
    this.squares.fill(0);
    this.elapsed = 0;
  }
}

/** Below these the alternating part is the noise of the calculation. */
export const VARYING_FLOOR = { V: 1e-3, A: 1e-6 };

/** The alternating part of a signal: what is left of its RMS without its mean. */
export const acPart = (mean: number, rms: number) => Math.sqrt(Math.max(0, rms * rms - mean * mean));

/**
 * Whether a signal varies enough to be read by its RMS rather than by its value: its alternating part beyond
 * 1% of the RMS and beyond the floor. False before the first window, and for DC with the ripple of the calculation.
 */
export function isVarying(mean: number, rms: number, floor: number): boolean {
  if (Number.isNaN(mean) || Number.isNaN(rms)) return false;
  const ac = acPart(mean, rms);
  return ac > 0.01 * rms && ac > floor;
}

/** Whether the mean of a varying signal is worth a line of its own: beyond 2% of its RMS and the floor. */
export const hasMean = (mean: number, rms: number, floor: number) => Math.abs(mean) > 0.02 * rms && Math.abs(mean) > floor;
