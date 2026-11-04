/** What is measured on one trace, over whole periods when the signal has them. */
export interface TraceStats {
  max: number;
  min: number;
  mean: number;
  rms: number;
  /** Null when fewer than two rising edges are in view. */
  frequency: number | null;
}

/** Below this fraction of its size a signal counts as flat: it has no edges to trigger on. */
const FLAT = 1e-6;

/** The latest samples of the traces, in a ring: at the rate of the solver, a frame must not copy them. */
export class ScopeBuffer {
  private readonly times: Float64Array;
  private channels: Float64Array[] = [];
  private head = 0;
  private count = 0;

  /**
   * By default, 27 s of the solver at 2400 steps a second: the trigger looks for an edge up to two
   * windows back, and the longest window is 10 s.
   */
  constructor(private readonly capacity = 65536) {
    this.times = new Float64Array(capacity);
  }

  reset(channelCount: number) {
    this.channels = Array.from({ length: channelCount }, () => new Float64Array(this.capacity));
    this.head = 0;
    this.count = 0;
  }

  get size(): number {
    return this.count;
  }

  get oldestTime(): number | null {
    return this.count > 0 ? this.timeAt(0) : null;
  }

  get latestTime(): number | null {
    return this.count > 0 ? this.timeAt(this.count - 1) : null;
  }

  private slot(index: number): number {
    return (this.head + index) % this.capacity;
  }

  private timeAt(index: number): number {
    return this.times[this.slot(index)];
  }

  private valueAt(channel: number, index: number): number {
    return this.channels[channel][this.slot(index)];
  }

  append(time: Float64Array, values: Float64Array[]) {
    if (values.length !== this.channels.length) return;
    // The clock restarts when a circuit does: what came before no longer belongs on the same axis
    if (time.length > 0 && this.count > 0 && time[0] < this.timeAt(this.count - 1)) {
      this.head = 0;
      this.count = 0;
    }
    for (let i = 0; i < time.length; i++) {
      const slot = this.count < this.capacity ? this.slot(this.count) : this.head;
      this.times[slot] = time[i];
      values.forEach((channel, c) => (this.channels[c][slot] = channel[i]));
      if (this.count < this.capacity) this.count++;
      else this.head = (this.head + 1) % this.capacity;
    }
  }

  /** Index of the first sample at or after t. */
  private lowerBound(t: number): number {
    let [lo, hi] = [0, this.count];
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.timeAt(mid) < t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  private range(channel: number, from: number, to: number): { min: number; max: number } | null {
    let [min, max] = [Infinity, -Infinity];
    for (let i = from; i < to; i++) {
      const v = this.valueAt(channel, i);
      if (v < min) min = v;
      if (v > max) max = v;
    }
    return min <= max ? { min, max } : null;
  }

  private isFlat({ min, max }: { min: number; max: number }): boolean {
    return max - min <= FLAT * Math.max(Math.abs(min), Math.abs(max), 1e-3);
  }

  /**
   * Rising edges in the whole buffer: up through the top of a band around the middle, after being
   * below its bottom, so that noise near the middle does not count twice. None for a flat signal.
   */
  risingEdges(channel: number): number {
    if (channel >= this.channels.length) return 0;
    const range = this.range(channel, 0, this.count);
    if (!range || this.isFlat(range)) return 0;
    const middle = (range.min + range.max) / 2;
    const band = (range.max - range.min) * 0.1;
    let [edges, isLow] = [0, false];
    for (let i = 0; i < this.count; i++) {
      const v = this.valueAt(channel, i);
      if (v < middle - band) isLow = true;
      else if (v > middle + band && isLow) {
        edges++;
        isLow = false;
      }
    }
    return edges;
  }

  /** Time of the rising edge through mid level, interpolated between samples. */
  private crossing(channel: number, index: number, level: number): number {
    const [a, b] = [this.valueAt(channel, index - 1), this.valueAt(channel, index)];
    const [ta, tb] = [this.timeAt(index - 1), this.timeAt(index)];
    return ta + ((level - a) / (b - a)) * (tb - ta);
  }

  /**
   * Start of a sweep of the given length around the latest rising edge that leaves it complete, so
   * that a periodic signal stands still. The edge comes `pretrigger` seconds after the start: with half
   * the span, it sits in the middle of the screen. Null when there is none, as with a flat signal.
   */
  triggerStart(channel: number, span: number, pretrigger = 0): number | null {
    const latest = this.latestTime;
    const oldest = this.oldestTime;
    if (latest === null || oldest === null || channel >= this.channels.length) return null;
    const from = this.lowerBound(latest - 2 * span + pretrigger);
    const range = this.range(channel, from, this.count);
    if (!range || this.isFlat(range)) return null;
    const level = (range.min + range.max) / 2;
    const last = this.lowerBound(latest - span + pretrigger + 1e-15);
    for (let i = Math.min(last, this.count - 1); i > 0 && i >= from; i--) {
      if (this.valueAt(channel, i - 1) < level && this.valueAt(channel, i) >= level) {
        const start = this.crossing(channel, i, level) - pretrigger;
        return start >= oldest ? start : null;
      }
    }
    return null;
  }

  /** Min and max of each of the columns between two times, flat as [min, max, min, max...]; NaN where there is no sample. */
  columns(channel: number, t0: number, t1: number, columnCount: number): Float64Array {
    const out = new Float64Array(columnCount * 2).fill(NaN);
    if (this.count === 0 || t1 <= t0 || channel >= this.channels.length) return out;
    const end = this.lowerBound(t1 + 1e-15);
    for (let i = this.lowerBound(t0); i < end; i++) {
      const column = Math.min(columnCount - 1, Math.floor(((this.timeAt(i) - t0) / (t1 - t0)) * columnCount));
      const v = this.valueAt(channel, i);
      const [min, max] = [out[column * 2], out[column * 2 + 1]];
      if (!(v >= min)) out[column * 2] = v;
      if (!(v <= max)) out[column * 2 + 1] = v;
    }
    return out;
  }

  /** The sample nearest to t. */
  sampleAt(channel: number, t: number): number | null {
    if (this.count === 0 || channel >= this.channels.length) return null;
    const after = Math.min(this.lowerBound(t), this.count - 1);
    const before = Math.max(after - 1, 0);
    return this.valueAt(channel, Math.abs(this.timeAt(before) - t) <= Math.abs(this.timeAt(after) - t) ? before : after);
  }

  stats(channel: number, t0: number, t1: number): TraceStats | null {
    if (channel >= this.channels.length) return null;
    let [from, to] = [this.lowerBound(t0), this.lowerBound(t1 + 1e-15)];
    const range = this.range(channel, from, to);
    if (!range) return null;

    // Mean and RMS over whole periods only, or a partial one would bias them
    let frequency: number | null = null;
    if (!this.isFlat(range)) {
      const level = (range.min + range.max) / 2;
      const edges: number[] = [];
      for (let i = Math.max(from, 1); i < to; i++) {
        if (this.valueAt(channel, i - 1) < level && this.valueAt(channel, i) >= level) edges.push(i);
      }
      if (edges.length >= 2) {
        const [first, last] = [edges[0], edges[edges.length - 1]];
        frequency = (edges.length - 1) / (this.crossing(channel, last, level) - this.crossing(channel, first, level));
        [from, to] = [first, last];
      }
    }

    let [sum, squares] = [0, 0];
    for (let i = from; i < to; i++) {
      const v = this.valueAt(channel, i);
      sum += v;
      squares += v * v;
    }
    const samples = to - from;
    return { ...range, mean: sum / samples, rms: Math.sqrt(squares / samples), frequency };
  }
}
