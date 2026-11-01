import { parseSpiceValue } from '../netlist/values';

/** Source voltage as a function of time. */
export type Waveform = (t: number) => number;

const FUNCTION_CALL = /^(sin|pulse)\s*\(([^)]*)\)$/i;

function parseArgs(text: string): number[] | null {
  const parts = text.trim().split(/[\s,]+/).filter(Boolean);
  const values = parts.map(parseSpiceValue);
  return values.includes(null) ? null : (values as number[]);
}

/** SPICE SIN(VO VA FREQ TD THETA PHASE). Before TD the source holds its value at TD. */
function sine([vo = 0, va = 0, freq = 0, td = 0, theta = 0, phase = 0]: number[]): Waveform {
  const phi = (phase * Math.PI) / 180;
  return (t) => {
    const elapsed = Math.max(t - td, 0);
    return vo + va * Math.exp(-theta * elapsed) * Math.sin(2 * Math.PI * freq * elapsed + phi);
  };
}

/** SPICE PULSE(V1 V2 TD TR TF PW PER). */
function pulse([v1 = 0, v2 = 0, td = 0, tr = 0, tf = 0, pw = Infinity, per = Infinity]: number[]): Waveform {
  return (t) => {
    if (t < td) return v1;
    const local = Number.isFinite(per) && per > 0 ? (t - td) % per : t - td;
    if (local < tr) return v1 + ((v2 - v1) * local) / tr;
    if (local < tr + pw) return v2;
    if (local < tr + pw + tf) return v2 + ((v1 - v2) * (local - tr - pw)) / tf;
    return v1;
  };
}

export interface WaveformStats {
  max: number;
  min: number;
  /** Max minus min. */
  range: number;
  frequency: number;
  /** True RMS over one period, offset included. */
  rms: number;
}

const toStats = (max: number, min: number, frequency: number, rms: number): WaveformStats => ({ max, min, range: max - min, frequency, rms });

/** One period of PULSE(...), including a ramp or a flat top cut short by the period. */
function pulseStats([v1 = 0, v2 = 0, , tr = 0, tf = 0, pw = Infinity, per = Infinity]: number[]): WaveformStats | null {
  if (!Number.isFinite(per) || per <= 0) return null;
  let left = per;
  let squared = 0;
  let max = -Infinity;
  let min = Infinity;
  const segment = (duration: number, from: number, to: number) => {
    const d = Math.min(duration, left);
    if (d <= 0) return;
    const end = from + ((to - from) * d) / duration;
    squared += (d * (from * from + from * end + end * end)) / 3;
    max = Math.max(max, from, end);
    min = Math.min(min, from, end);
    left -= d;
  };
  segment(tr, v1, v2);
  segment(pw, v2, v2);
  segment(tf, v2, v1);
  segment(left, v1, v1);
  return toStats(max, min, 1 / per, Math.sqrt(squared / per));
}

/**
 * Steady-state values of a periodic source, computed from the spec and so exact.
 * Null for what has no period to measure: DC, a damped sine, a single pulse, an invalid spec.
 */
export function waveformStats(spec: string): WaveformStats | null {
  const call = FUNCTION_CALL.exec(spec.trim());
  const args = call && parseArgs(call[2]);
  if (!call || !args) return null;
  if (call[1].toLowerCase() === 'pulse') return pulseStats(args);
  const [vo = 0, va = 0, freq = 0, , theta = 0] = args;
  if (freq <= 0 || theta !== 0) return null;
  const amplitude = Math.abs(va);
  return toStats(vo + amplitude, vo - amplitude, freq, Math.sqrt(vo * vo + (va * va) / 2));
}

/** Parses the source specs the netlist accepts: "5", "DC 5", "SIN(...)", "PULSE(...)". */
export function parseWaveform(spec: string): Waveform | null {
  const text = spec.trim();
  const call = FUNCTION_CALL.exec(text);
  if (call) {
    const args = parseArgs(call[2]);
    if (!args) return null;
    return call[1].toLowerCase() === 'sin' ? sine(args) : pulse(args);
  }
  const value = parseSpiceValue(text.replace(/^dc\s+/i, ''));
  return value === null ? null : () => value;
}
