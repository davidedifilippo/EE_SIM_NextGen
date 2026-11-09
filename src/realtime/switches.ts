import { Element } from '../model/types';

/**
 * A toggle stays where it is put; a push button only while pressed; a changeover sends the common to one of
 * two ways; the three-way one to one of three, through the middle one each time it moves.
 */
export type SwitchKind = 'toggle' | 'pushno' | 'pushnc' | 'spdt' | 'sp3t';

/**
 * The positions of the three-way changeover as a click moves it: 1, the middle, 3, the middle again. The two
 * middles are the same contact, told apart only by where the next click goes.
 */
export const SP3T_POSITIONS = ['1', '2', '3', '4'] as const;
const SP3T_WAY: Record<string, number> = { '1': 0, '2': 1, '3': 2, '4': 1 };

/** Where a click moves the three-way changeover: on along 1, 2, 3, 2, 1. */
export function nextSp3tPosition(position: string | undefined): string {
  const k = SP3T_POSITIONS.indexOf((position ?? '2') as (typeof SP3T_POSITIONS)[number]);
  return SP3T_POSITIONS[(Math.max(k, 0) + 1) % SP3T_POSITIONS.length];
}

/** A closed contact: as small as the ammeter, so that even a short on a battery has a solution. */
export const CONTACT_CLOSED = 1e-3;
/** An open contact: as the other leaks of the project, so that a node left alone keeps a voltage. */
export const CONTACT_OPEN = 1e9;

/** Which way is closed, counted from 0 in the order of the ways; -1 for none. */
export function closedWay(kind: SwitchKind, props: Element['props']): number {
  const isPressed = String(props.pressed ?? '0') === '1';
  switch (kind) {
    case 'toggle':
      return String(props.closed ?? '0') === '1' ? 0 : -1;
    case 'pushno':
      return isPressed ? 0 : -1;
    case 'pushnc':
      return isPressed ? -1 : 0;
    case 'spdt':
      return String(props.position ?? '1') === '2' ? 1 : 0;
    case 'sp3t':
      return SP3T_WAY[String(props.position ?? '2')] ?? 1;
  }
}

/** The resistance between the common and each way, in the order of the ways. */
export function contactResistances(kind: SwitchKind, props: Element['props']): number[] {
  const ways = kind === 'sp3t' ? 3 : kind === 'spdt' ? 2 : 1;
  const closed = closedWay(kind, props);
  return Array.from({ length: ways }, (_, k) => (k === closed ? CONTACT_CLOSED : CONTACT_OPEN));
}
