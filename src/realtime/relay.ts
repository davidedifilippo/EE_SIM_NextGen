import { RelaySpec } from '../model/types';

export type { RelaySpec };

/** The coil currents at which the contact closes and opens again: the voltages of the datasheet over the coil. */
export function relayThresholds(spec: RelaySpec): { pickup: number; dropout: number } {
  return { pickup: spec.pickup / spec.coilResistance, dropout: spec.dropout / spec.coilResistance };
}

/** The contact after a step: it closes above the pick-up current and opens below the drop-out one, in either direction. */
export function nextRelayState(spec: RelaySpec, isClosed: boolean, current: number): boolean {
  const { pickup, dropout } = relayThresholds(spec);
  const size = Math.abs(current);
  return isClosed ? size >= dropout : size > pickup;
}
