import { BreadboardPlace, BreadboardWire, Circuit, Element, Pt, Rotation } from '../model/types';
import { firstLeads, footprintOf } from './footprints';

/** The colours of the jumpers of a kit, in the order a new one takes them. */
export const JUMPER_COLORS = [
  { value: '#dc2626', label: 'Rosso' },
  { value: '#111827', label: 'Nero' },
  { value: '#2563eb', label: 'Blu' },
  { value: '#16a34a', label: 'Verde' },
  { value: '#eab308', label: 'Giallo' },
  { value: '#ea580c', label: 'Arancio' },
  { value: '#f8fafc', label: 'Bianco' },
];

export const jumpersOf = (circuit: Circuit): BreadboardWire[] => circuit.breadboard?.wires ?? [];

const withJumpers = (circuit: Circuit, wires: BreadboardWire[]): Circuit => ({ ...circuit, breadboard: { ...circuit.breadboard, wires } });

/** The part mounted at a point: its leads, if it has two, start there. */
export function placeAt(el: Element, at: Pt): BreadboardPlace {
  const footprint = footprintOf(el);
  return footprint?.hasLeads ? { x: at.x, y: at.y, rot: 0, legs: firstLeads(footprint, at) } : { x: at.x, y: at.y, rot: 0 };
}

/** Moved by a step: the leads go along. */
export function movedPlace(place: BreadboardPlace, by: Pt): BreadboardPlace {
  const move = (p: Pt) => ({ x: p.x + by.x, y: p.y + by.y });
  return { ...place, ...move(place), ...(place.legs ? { legs: [move(place.legs[0]), move(place.legs[1])] as [Pt, Pt] } : {}) };
}

/**
 * A quarter turn clockwise: a part with two leads turns its second lead around the first. An instrument with
 * a display, as the bench supply, stays upright.
 */
export function turnedPlace(place: BreadboardPlace, canTurn = true): BreadboardPlace {
  if (!canTurn) return place;
  if (place.legs) {
    const [a, b] = place.legs;
    return { ...place, legs: [a, { x: a.x - (b.y - a.y), y: a.y + (b.x - a.x) }] };
  }
  return { ...place, rot: ((place.rot + 90) % 360) as Rotation };
}

export const updateElements = (circuit: Circuit, ids: Set<string>, change: (el: Element) => Element): Circuit => ({
  ...circuit,
  elements: circuit.elements.map((el) => (ids.has(el.id) ? change(el) : el)),
});

/** The selected parts turned on the breadboard. */
export const turnOnBoard = (circuit: Circuit, ids: Set<string>): Circuit => updateElements(circuit, ids, (el) => (el.bb ? { ...el, bb: turnedPlace(el.bb, footprintOf(el)?.art !== 'benchsupply') } : el));

/** Out of the breadboard: the selected jumpers go, the selected parts back to the tray, still in the schematic. */
export function removeFromBoard(circuit: Circuit, ids: Set<string>): Circuit {
  const next = updateElements(circuit, ids, (el) => {
    const { bb: _, ...rest } = el;
    return rest;
  });
  return withJumpers(next, jumpersOf(circuit).filter((w) => !ids.has(w.id)));
}

/**
 * A press on a part that has a lever: a switch closes or opens, a changeover goes to its other way. It is
 * the same part as in the schematic, so its lever moves there too. Null for a part with nothing to press.
 */
export function pressOnBoard(circuit: Circuit, id: string): Circuit | null {
  const el = circuit.elements.find((e) => e.id === id);
  const art = el && footprintOf(el)?.art;
  if (art === 'toggle') return updateElements(circuit, new Set([id]), (e) => ({ ...e, props: { ...e.props, closed: e.props.closed === '1' ? '0' : '1' } }));
  if (art === 'slide') return updateElements(circuit, new Set([id]), (e) => ({ ...e, props: { ...e.props, position: e.props.position === '2' ? '1' : '2' } }));
  return null;
}

/** A push button held down, or let go: the same part as in the schematic, where its bar moves too. */
export const holdOnBoard = (circuit: Circuit, id: string, isHeld: boolean): Circuit => updateElements(circuit, new Set([id]), (e) => ({ ...e, props: { ...e.props, pressed: isHeld ? '1' : '0' } }));

export function addJumper(circuit: Circuit, a: Pt, b: Pt, id: string): Circuit {
  const wires = jumpersOf(circuit);
  return withJumpers(circuit, [...wires, { id, a, b, color: JUMPER_COLORS[wires.length % JUMPER_COLORS.length].value }]);
}

export const changeJumper = (circuit: Circuit, id: string, change: Partial<BreadboardWire>): Circuit =>
  withJumpers(
    circuit,
    jumpersOf(circuit).map((w) => (w.id === id ? { ...w, ...change } : w)),
  );
