import { Circuit, Element, Pt, SpiceModel, Wire } from '../model/types';
import { getDevice, nextTag } from '../library/devices';
import { findModel, usedModelNames } from '../library/models';
import { Box, dist, GRID_SIZE, isPointInBox, isPointOnSegment, localToWorld, snapPt } from '../utils/geometry';

/** What was copied, with the cards of its models: the circuit it is pasted into may not have them. */
export interface Clip {
  elements: Element[];
  wires: Wire[];
  models: SpiceModel[];
}

/** How far each paste lands from the one before, enough for the copies not to cover each other. */
export const PASTE_STEP = 4 * GRID_SIZE;

/** Null with nothing selected. Takes the circuit with the library models, so that those travel too. */
export function copySelection(circuit: Circuit, ids: Set<string>): Clip | null {
  const elements = circuit.elements.filter((el) => ids.has(el.id));
  const wires = circuit.wires.filter((w) => ids.has(w.id));
  if (elements.length + wires.length === 0) return null;
  const models = usedModelNames({ ...circuit, elements }).flatMap((name) => {
    const model = findModel(circuit, name);
    return model ? [model] : [];
  });
  return { elements, wires, models };
}

function clipMiddle(clip: Clip): Pt {
  const points = [...clip.elements, ...clip.wires.flatMap((w) => w.pts)];
  const [xs, ys] = [points.map((p) => p.x), points.map((p) => p.y)];
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
}

/** The move that puts the middle of the clip on a point of the sheet, on the grid. */
export function moveToCenter(clip: Clip, point: Pt): Pt {
  const middle = clipMiddle(clip);
  return snapPt({ x: point.x - middle.x, y: point.y - middle.y });
}

/** The move asked for, unless the copy would land out of sight: the view may have gone elsewhere since the copy. */
export function moveInView(clip: Clip, move: Pt, view: Box): Pt {
  const middle = clipMiddle(clip);
  if (isPointInBox({ x: middle.x + move.x, y: middle.y + move.y }, view)) return move;
  return moveToCenter(clip, { x: (view.x1 + view.x2) / 2, y: (view.y1 + view.y2) / 2 });
}

const terminalsOf = (elements: Element[]) =>
  elements.flatMap((el) => (getDevice(el.def)?.terminals ?? []).map((t) => localToWorld(el.x, el.y, t, el.rot, el.flip)));

const tipsOf = (wires: Wire[]) => wires.flatMap((w) => [w.pts[0], w.pts[w.pts.length - 1]]);

const isAlong = (p: Pt, wires: Wire[]) => wires.some((w) => w.pts.slice(1).some((b, i) => isPointOnSegment(p, w.pts[i], b)));

/**
 * Pushes a copy further until it touches nothing. Landing on a terminal or a wire would connect it
 * to the original, in the simulation too, and the wire would stay held there when the copy is dragged.
 */
export function clearOfCircuit(circuit: Circuit, clip: Clip, move: Pt): Pt {
  const staying = [...terminalsOf(circuit.elements), ...tipsOf(circuit.wires)];
  const movedBy = (m: Pt) => {
    const elements = clip.elements.map((el) => ({ ...el, x: el.x + m.x, y: el.y + m.y }));
    const wires = clip.wires.map((w) => ({ ...w, pts: w.pts.map((p) => ({ x: p.x + m.x, y: p.y + m.y })) }));
    return { wires, points: [...terminalsOf(elements), ...tipsOf(wires)] };
  };
  const touches = (m: Pt) => {
    const { wires, points } = movedBy(m);
    return points.some((p) => staying.some((q) => dist(p, q) < 2) || isAlong(p, circuit.wires)) || staying.some((q) => isAlong(q, wires));
  };
  let clear = move;
  // Ends at the latest once the copy is past the whole circuit, where there is nothing left to touch
  while (touches(clear)) clear = { x: clear.x + PASTE_STEP, y: clear.y + PASTE_STEP };
  return clear;
}

export interface PasteResult {
  circuit: Circuit;
  ids: Set<string>;
  /** Models of the clip that this circuit already has with another card: its own stay. */
  conflicts: string[];
}

/**
 * Adds a copy of the clip with new ids and the first free tags. `available` is the circuit with the
 * library models, for a model already known not to be added again; `stamp` keeps the ids unique.
 */
export function pasteClipboard(circuit: Circuit, available: Circuit, clip: Clip, move: Pt, stamp: number): PasteResult {
  const elements = [...circuit.elements];
  const ids = new Set<string>();
  clip.elements.forEach((el, k) => {
    const prefix = getDevice(el.def)?.tagPrefix;
    // A copy goes to the tray of the breadboard: on the original's holes it would short it
    const { bb: _, ...original } = el;
    const pasted: Element = { ...original, id: `elem_${stamp}_${k}`, x: el.x + move.x, y: el.y + move.y, tag: prefix ? nextTag(prefix, elements) : el.tag, props: { ...el.props } };
    elements.push(pasted);
    ids.add(pasted.id);
  });
  const wires = [...circuit.wires];
  clip.wires.forEach((w, k) => {
    const pasted: Wire = { id: `wire_${stamp}_${k}`, pts: w.pts.map((p) => ({ x: p.x + move.x, y: p.y + move.y })) };
    wires.push(pasted);
    ids.add(pasted.id);
  });
  const missing = clip.models.filter((m) => !findModel(available, m.name));
  const conflicts = clip.models.filter((m) => {
    const known = findModel(available, m.name);
    return known && known.card !== m.card;
  });
  return { circuit: { ...circuit, elements, wires, models: [...circuit.models, ...missing] }, ids, conflicts: conflicts.map((m) => m.name) };
}
