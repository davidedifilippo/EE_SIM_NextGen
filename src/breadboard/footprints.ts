import { getDevice } from '../library/devices';
import { BreadboardPlace, Element, Pt } from '../model/types';
import { rotatePt } from '../utils/geometry';
import { PITCH } from './board';
import { parseSpiceValue } from '../netlist/values';

/**
 * How each part sits on the breadboard: where its pins go, and which terminal of the schematic each is.
 * A part with two leads has them free, to bend to any hole; the others have their pins fixed in a footprint.
 */

export type Art =
  | 'resistor'
  | 'ceramic'
  | 'electrolytic'
  | 'inductor'
  | 'diode'
  | 'zener'
  | 'led'
  | 'to92'
  | 'to220'
  | 'trimmer'
  | 'tactile'
  | 'toggle'
  | 'slide'
  | 'lamp'
  | 'generic';

export interface FootprintPin {
  terminal: string;
  /** Where it goes, from the place of the part before it turns. */
  at: Pt;
  /** What is printed beside it, for the hint on hovering. */
  label: string;
}

export interface Footprint {
  art: Art;
  pins: FootprintPin[];
  /** Two leads bent to holes of their own: the pins are the ends in the place, not these. */
  hasLeads: boolean;
}

const pin = (terminal: string, x: number, y: number, label = terminal): FootprintPin => ({ terminal, at: { x: x * PITCH, y: y * PITCH }, label });

/** The leads of a part with two, four pitches apart: the 400 mil of a resistor. */
const leads = (art: Art, a: string, b: string, span = 4, labels: [string, string] = [a, b]): Footprint => ({ art, hasLeads: true, pins: [pin(a, 0, 0, labels[0]), pin(b, span, 0, labels[1])] });

/** From the left, flat face towards whoever looks: the pinout of each transistor of the library. */
const TRANSISTOR_PINS: Record<string, { pins: string[]; art: Art }> = {
  '2N3904': { pins: ['E', 'B', 'C'], art: 'to92' },
  '2N3906': { pins: ['E', 'B', 'C'], art: 'to92' },
  '2N2222A': { pins: ['E', 'B', 'C'], art: 'to92' },
  '2N2907A': { pins: ['E', 'B', 'C'], art: 'to92' },
  BC547B: { pins: ['C', 'B', 'E'], art: 'to92' },
  BC557B: { pins: ['C', 'B', 'E'], art: 'to92' },
  BD139: { pins: ['E', 'C', 'B'], art: 'to220' },
  BD140: { pins: ['E', 'C', 'B'], art: 'to220' },
  TIP31C: { pins: ['B', 'C', 'E'], art: 'to220' },
  TIP32C: { pins: ['B', 'C', 'E'], art: 'to220' },
  '2N7000': { pins: ['S', 'G', 'D'], art: 'to92' },
  BS170: { pins: ['D', 'G', 'S'], art: 'to92' },
  IRF540N: { pins: ['G', 'D', 'S'], art: 'to220' },
  IRF9540N: { pins: ['G', 'D', 'S'], art: 'to220' },
  IRLZ44N: { pins: ['G', 'D', 'S'], art: 'to220' },
};
const TERMINAL_OF: Record<string, string> = { E: 'emitter', B: 'base', C: 'collector', S: 'source', G: 'gate', D: 'drain' };

/** A capacitor from 1 µF up is an electrolytic, below a ceramic disc. */
export function isElectrolytic(value: string | number | undefined): boolean {
  const farad = parseSpiceValue(String(value ?? ''));
  return farad !== null && farad >= 1e-6 * (1 - 1e-9);
}

/** The footprint of a part, or null for those with no body on the breadboard, as ground. */
export function footprintOf(el: Element): Footprint | null {
  const def = getDevice(el.def);
  if (!def) return null;
  const spice = def.spice;
  if (spice.kind === 'ground' || spice.kind === 'port') return null;
  switch (el.def) {
    case 'resistor':
      return leads('resistor', 'a', 'b');
    case 'capacitor':
      return isElectrolytic(el.props.value) ? leads('electrolytic', 'a', 'b', 1, ['+', '−']) : leads('ceramic', 'a', 'b', 1);
    case 'inductor':
      return leads('inductor', 'a', 'b');
    case 'diode':
      return leads('diode', 'anode', 'cathode', 4, ['A', 'K']);
    case 'zener':
      return leads('zener', 'anode', 'cathode', 4, ['A', 'K']);
    case 'led':
      return leads('led', 'anode', 'cathode', 1, ['A', 'K']);
    case 'potentiometer':
      return { art: 'trimmer', hasLeads: false, pins: [pin('a', 0, 0, '1'), pin('w', 1, 0, '2'), pin('b', 2, 0, '3')] };
    case 'pushno':
    case 'pushnc':
      // Astride the groove: the two pins on each side of the button are one inside it
      return { art: 'tactile', hasLeads: false, pins: [pin('a', 0, 0, '1'), pin('a', 0, 3, '2'), pin('b', 2, 0, '3'), pin('b', 2, 3, '4')] };
    case 'switch':
      return { art: 'toggle', hasLeads: false, pins: [pin('a', 0, 0, '1'), pin('b', 2, 0, '2')] };
    case 'spdt':
      return { art: 'slide', hasLeads: false, pins: [pin('1', 0, 0, '1'), pin('c', 1, 0, 'C'), pin('2', 2, 0, '2')] };
    case 'lamp':
      return { art: 'lamp', hasLeads: false, pins: [pin('a', 0, 0, '1'), pin('b', 2, 0, '2')] };
  }
  if (spice.kind === 'bjt' || spice.kind === 'mos') {
    const known = TRANSISTOR_PINS[String(el.props[spice.modelProp] ?? '').toUpperCase()] ?? TRANSISTOR_PINS[String(el.props[spice.modelProp] ?? '')];
    const order = known?.pins ?? (spice.kind === 'bjt' ? ['E', 'B', 'C'] : ['S', 'G', 'D']);
    return { art: known?.art ?? 'to92', hasLeads: false, pins: order.map((letter, k) => pin(TERMINAL_OF[letter], k, 0, letter)) };
  }
  // Anything else: its pins in a row, for now
  return { art: 'generic', hasLeads: false, pins: def.terminals.map((t, k) => pin(t.id, k, 0, t.id)) };
}

/** Where the leads of a part with two go when it is first mounted at a point. */
export const firstLeads = (footprint: Footprint, at: Pt): [Pt, Pt] => [
  { x: at.x + footprint.pins[0].at.x, y: at.y + footprint.pins[0].at.y },
  { x: at.x + footprint.pins[1].at.x, y: at.y + footprint.pins[1].at.y },
];

/** Where each pin of a mounted part is on the breadboard. */
export function pinPoints(el: Element, place: BreadboardPlace = el.bb!): { terminal: string; label: string; at: Pt }[] {
  const footprint = footprintOf(el);
  if (!footprint) return [];
  if (footprint.hasLeads) {
    const ends = place.legs ?? firstLeads(footprint, place);
    return footprint.pins.map((p, k) => ({ terminal: p.terminal, label: p.label, at: ends[k] }));
  }
  return footprint.pins.map((p) => {
    const r = rotatePt(p.at, place.rot);
    return { terminal: p.terminal, label: p.label, at: { x: place.x + r.x, y: place.y + r.y } };
  });
}
