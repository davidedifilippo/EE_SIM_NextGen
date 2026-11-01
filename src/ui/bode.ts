/** Below this a node has no AC signal at all: its gain would be minus infinity. */
const NO_SIGNAL = 1e-12;
/** Half the power: 20*log10(sqrt(2)). */
const CUTOFF_DROP = 10 * Math.log10(2);

export interface BodeCurve {
  gain: number[];
  phase: number[];
}

export const hasSignal = (re: number[], im: number[]) => re.some((v, i) => Math.hypot(v, im[i]) > NO_SIGNAL);

/** Gain in dB and phase in degrees, with the jumps of 360 degrees taken out so that a curve stays one line. */
export function bodeCurve(re: number[], im: number[]): BodeCurve {
  const gain = re.map((v, i) => 20 * Math.log10(Math.max(Math.hypot(v, im[i]), NO_SIGNAL)));
  const phase: number[] = [];
  let turns = 0;
  re.forEach((v, i) => {
    const raw = (Math.atan2(im[i], v) * 180) / Math.PI;
    if (i > 0) {
      const previous = phase[i - 1] - turns;
      if (raw - previous > 180) turns -= 360;
      else if (raw - previous < -180) turns += 360;
    }
    phase.push(raw + turns);
  });
  return { gain, phase };
}

/** Where a curve crosses a level between two samples: linear in dB against the logarithm of frequency, as Bode plots are read. */
const crossing = (frequency: number[], gain: number[], a: number, b: number, level: number) => {
  const u = (level - gain[a]) / (gain[b] - gain[a]);
  return Math.exp(Math.log(frequency[a]) + u * (Math.log(frequency[b]) - Math.log(frequency[a])));
};

export interface BodeSummary {
  peak: number;
  peakFrequency: number;
  /** Where the gain falls 3 dB below the peak, on either side. Null if it never does within the sweep. */
  lower: number | null;
  upper: number | null;
}

export function bodeSummary(frequency: number[], gain: number[]): BodeSummary {
  let top = 0;
  gain.forEach((g, i) => {
    if (g > gain[top]) top = i;
  });
  const level = gain[top] - CUTOFF_DROP;
  let [lower, upper]: (number | null)[] = [null, null];
  for (let i = top; i > 0; i--) {
    if (gain[i - 1] < level) {
      lower = crossing(frequency, gain, i - 1, i, level);
      break;
    }
  }
  for (let i = top; i + 1 < gain.length; i++) {
    if (gain[i + 1] < level) {
      upper = crossing(frequency, gain, i, i + 1, level);
      break;
    }
  }
  return { peak: gain[top], peakFrequency: frequency[top], lower, upper };
}

/** Round frequencies at each power of ten inside the sweep. */
export function decadeTicks(from: number, to: number): number[] {
  const ticks: number[] = [];
  for (let e = Math.ceil(Math.log10(from) - 1e-9); e <= Math.floor(Math.log10(to) + 1e-9); e++) ticks.push(10 ** e);
  return ticks;
}

/** Multiples of 45, 90 or 180 degrees covering the range, the ones a phase is read at. */
export function phaseTicks(min: number, max: number): number[] {
  const span = max - min;
  const step = span <= 180 ? 45 : span <= 360 ? 90 : 180;
  const ticks: number[] = [];
  const last = Math.ceil(max / step - 1e-9) * step;
  for (let v = Math.floor(min / step + 1e-9) * step; v <= last; v += step) ticks.push(v);
  return ticks.length > 1 ? ticks : [ticks[0] - step, ticks[0], ticks[0] + step];
}
