/** Round axis ticks covering [min, max], with the first and last tick outside or on the range. */
export function niceTicks(min: number, max: number, target: number): number[] {
  if (min === max) {
    const pad = Math.abs(min) || 1;
    return niceTicks(min - pad, max + pad, target);
  }
  const rough = (max - min) / Math.max(target - 1, 1);
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const norm = rough / magnitude;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * magnitude;
  const first = Math.floor(min / step + 1e-9);
  const last = Math.ceil(max / step - 1e-9);
  const ticks: number[] = [];
  // Multiplying each index avoids the rounding drift of repeated addition
  for (let i = first; i <= last; i++) ticks.push(Number((i * step).toPrecision(12)));
  return ticks;
}

export function formatSi(v: number): string {
  return Number(v.toPrecision(4)).toString().replace('.', ',');
}

/** Fixed decimals with the Italian comma, without the "-0,000" of tiny negative values. */
export function formatFixed(v: number, decimals: number): string {
  const text = v.toFixed(decimals);
  return (Number(text) === 0 ? text.replace('-', '') : text).replace('.', ',');
}

const ENGINEERING: [number, string][] = [
  [1e6, 'M'],
  [1e3, 'k'],
  [1, ''],
  [1e-3, 'm'],
  [1e-6, 'µ'],
  [1e-9, 'n'],
  [1e-12, 'p'],
];

/** Readout with a unit: 0.0032, "A" gives "3,2 mA". Values too small to matter read as zero. */
export function formatEngineering(value: number, unit: string): string {
  const abs = Math.abs(value);
  if (abs < 1e-12) return `0 ${unit}`;
  const [scale, prefix] = ENGINEERING.find(([s]) => abs >= s * 0.9995) ?? ENGINEERING[ENGINEERING.length - 1];
  return `${Number((value / scale).toPrecision(3)).toString().replace('.', ',')} ${prefix}${unit}`;
}

export function pickTimeUnit(maxSeconds: number): { factor: number; symbol: string } {
  if (maxSeconds >= 1) return { factor: 1, symbol: 's' };
  if (maxSeconds >= 1e-3) return { factor: 1e-3, symbol: 'ms' };
  if (maxSeconds >= 1e-6) return { factor: 1e-6, symbol: 'µs' };
  return { factor: 1e-9, symbol: 'ns' };
}

/** Index of the sample closest to t in a sorted array. */
export function nearestIndex(sorted: number[], t: number): number {
  let [lo, hi] = [0, sorted.length - 1];
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < t) lo = mid;
    else hi = mid;
  }
  return Math.abs(sorted[lo] - t) <= Math.abs(sorted[hi] - t) ? lo : hi;
}

/** Keeps the min and max of each pixel column, so narrow peaks survive downsampling. */
export function downsampleMinMax(time: number[], values: number[], columns: number): number[] {
  if (values.length <= columns * 2) return values.map((_, i) => i);
  const tMin = time[0];
  const span = time[time.length - 1] - tMin || 1;
  const result: number[] = [];
  let i = 0;
  for (let col = 0; col < columns && i < values.length; col++) {
    const end = tMin + (span * (col + 1)) / columns;
    let [minI, maxI] = [i, i];
    while (i < values.length && (time[i] <= end || col === columns - 1)) {
      if (values[i] < values[minI]) minI = i;
      if (values[i] > values[maxI]) maxI = i;
      i++;
    }
    if (minI === maxI) result.push(minI);
    else result.push(Math.min(minI, maxI), Math.max(minI, maxI));
  }
  return result;
}
