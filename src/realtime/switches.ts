import { Element } from '../model/types';

/** A toggle stays where it is put; a push button only while pressed; a changeover sends the common to one of two ways. */
export type SwitchKind = 'toggle' | 'pushno' | 'pushnc' | 'spdt';

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
  }
}

/** The resistance between the common and each way, in the order of the ways. */
export function contactResistances(kind: SwitchKind, props: Element['props']): number[] {
  const ways = kind === 'spdt' ? 2 : 1;
  const closed = closedWay(kind, props);
  return Array.from({ length: ways }, (_, k) => (k === closed ? CONTACT_CLOSED : CONTACT_OPEN));
}
