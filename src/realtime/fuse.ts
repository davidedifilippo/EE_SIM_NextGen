/**
 * A fuse: a short wire that warms with the square of its current and melts past a temperature. Its heat
 * follows (i/In)² with a time constant: 1 with its rated current for ever, so it never melts there. It melts at
 * a heat of 1.8², so that it never blows below 1.8 In, and the times of IEC 60127 come out within their
 * windows: for a quick-acting fuse (F) about 0.5 s at 2.1 In, 0.2 s at 2.75 In, 90 ms at 4 In, 13 ms at 10 In;
 * for a time-lag fuse (T) ten times as long. Estimated: one time constant stands for the whole curve.
 */

export type FuseType = 'F' | 'T';

/** Its resistance while whole: small, as the wire of a real one. */
export const FUSE_RESISTANCE = 0.01;
/** The heat where it melts, as a share of that of its rated current. */
export const FUSE_MELT = 1.8 * 1.8;
/** Time constants of the heat, of a quick-acting fuse and of a time-lag one. */
export const FUSE_TAU: Record<FuseType, number> = { F: 0.4, T: 4 };
/** Over a period of the mains: what says it is beyond its rating, steady on alternating current too. */
export const FUSE_RMS_TAU = 0.02;

export const FUSE_RATINGS = ['0.05', '0.1', '0.25', '0.5', '1', '2', '3.15', '5', '10', '16'];
export const FUSE_RATING_OPTIONS = FUSE_RATINGS.map((value) => ({ value, label: Number(value) < 1 ? `${Math.round(Number(value) * 1000)} mA` : `${value.replace('.', ',')} A` }));
export const FUSE_TYPE_OPTIONS: { value: FuseType; label: string }[] = [
  { value: 'F', label: 'Rapido (F)' },
  { value: 'T', label: 'Ritardato (T)' },
];

export interface FuseSpec {
  rating: number;
  tau: number;
}

export function fuseSpec(rating: unknown, type: unknown): FuseSpec | null {
  const amps = Number(rating);
  if (!Number.isFinite(amps) || amps <= 0) return null;
  return { rating: amps, tau: FUSE_TAU[type === 'T' ? 'T' : 'F'] };
}

/** The heat after a step of h with the current i, from the heat before; in pieces short against the time constant. */
export function nextHeat(spec: FuseSpec, heat: number, current: number, h: number): number {
  const target = (current / spec.rating) ** 2;
  return target + (heat - target) * Math.exp(-h / spec.tau);
}

/** How long a steady current takes to blow a cold fuse, in seconds; Infinity where it never does. */
export function blowTime(spec: FuseSpec, current: number): number {
  const target = (current / spec.rating) ** 2;
  return target <= FUSE_MELT ? Infinity : -spec.tau * Math.log(1 - FUSE_MELT / target);
}

export interface FuseStatus {
  /** Beyond its rated current: it is warming towards melting. */
  isOver: boolean;
  isBlown: boolean;
  /** Its heat as a share of the melting one, from 0 to 1. */
  heat: number;
}
