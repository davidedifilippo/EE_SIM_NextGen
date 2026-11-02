import { describe, expect, it } from 'vitest';
import { Circuit, Element } from '../model/types';
import { createElement, getDevice } from '../library/devices';
import { clearOfCircuit, copySelection, moveInView, moveToCenter, pasteClipboard, PASTE_STEP } from './clipboard';
import { anchoredWires } from './wireRouting';

const place = (circuit: Circuit, def: string, id: string, x = 0, y = 0): Circuit => ({
  ...circuit,
  elements: [...circuit.elements, createElement(getDevice(def)!, { x, y }, 0, circuit, id)],
});

const emptyCircuit = (): Circuit => ({ title: 't', elements: [], wires: [], models: [] });

const twoResistors = (): Circuit => ({
  ...place(place(emptyCircuit(), 'resistor', 'a', 0, 0), 'resistor', 'b', 100, 0),
  wires: [{ id: 'w', pts: [{ x: 0, y: 40 }, { x: 100, y: 40 }] }],
});

const paste = (circuit: Circuit, ids: string[], move = { x: 40, y: 40 }, target = circuit) =>
  pasteClipboard(target, target, copySelection(circuit, new Set(ids))!, move, 7);

describe('copySelection', () => {
  it('gives nothing for an empty selection', () => {
    expect(copySelection(twoResistors(), new Set())).toBeNull();
    expect(copySelection(twoResistors(), new Set(['gone']))).toBeNull();
  });

  it('takes only what is selected', () => {
    const clip = copySelection(twoResistors(), new Set(['a', 'w']))!;
    expect(clip.elements.map((el) => el.id)).toEqual(['a']);
    expect(clip.wires.map((w) => w.id)).toEqual(['w']);
  });
});

describe('pasteClipboard', () => {
  it('gives new ids and the first free tags, and keeps the values', () => {
    const circuit = twoResistors();
    circuit.elements[0].props.value = '4k7';
    const { circuit: next, ids } = paste(circuit, ['a', 'b']);
    expect(next.elements).toHaveLength(4);
    expect(new Set(next.elements.map((el) => el.id)).size).toBe(4);
    expect(next.elements.map((el) => el.tag)).toEqual(['R1', 'R2', 'R3', 'R4']);
    expect(next.elements[2].props.value).toBe('4k7');
    expect([...ids]).toEqual(['elem_7_0', 'elem_7_1']);
  });

  it('leaves the original alone', () => {
    const circuit = twoResistors();
    const { circuit: next } = paste(circuit, ['a', 'w']);
    next.elements[2].props.value = 'changed';
    expect(circuit.elements).toHaveLength(2);
    expect(circuit.elements[0].props.value).not.toBe('changed');
    expect(next.elements[0]).toBe(circuit.elements[0]);
  });

  it('moves parts and wires together', () => {
    const { circuit: next } = paste(twoResistors(), ['b', 'w'], { x: 40, y: 20 });
    expect(next.elements[2]).toMatchObject({ x: 140, y: 20 });
    expect(next.wires[1]).toEqual({ id: 'wire_7_0', pts: [{ x: 40, y: 60 }, { x: 140, y: 60 }] });
  });

  it('adds up the same clip pasted twice without repeating tags', () => {
    const circuit = twoResistors();
    const clip = copySelection(circuit, new Set(['a']))!;
    const first = pasteClipboard(circuit, circuit, clip, { x: 40, y: 40 }, 1).circuit;
    const second = pasteClipboard(first, first, clip, { x: 80, y: 80 }, 2).circuit;
    expect(second.elements.map((el) => el.tag)).toEqual(['R1', 'R2', 'R3', 'R4']);
    expect(second.elements[3]).toMatchObject({ x: 80, y: 80 });
    expect(new Set(second.elements.map((el) => el.id)).size).toBe(4);
  });

  it('keeps a ground without a tag', () => {
    const circuit = place(emptyCircuit(), 'ground', 'g');
    const { circuit: next } = paste(circuit, ['g']);
    expect(next.elements[1].tag).toBe('');
  });
});

describe('models between circuits', () => {
  const withImported = (card: string): Circuit => {
    const circuit = place(emptyCircuit(), 'diode', 'd');
    (circuit.elements[0] as Element).props.model = 'MYD';
    return { ...circuit, models: [{ name: 'MYD', card }] };
  };

  it('brings along the model into a circuit without it', () => {
    const { circuit: next, conflicts } = paste(withImported('.model MYD D(IS=1n)'), ['d'], undefined, emptyCircuit());
    expect(next.models).toEqual([{ name: 'MYD', card: '.model MYD D(IS=1n)' }]);
    expect(conflicts).toEqual([]);
  });

  it('adds nothing in the same circuit', () => {
    const circuit = withImported('.model MYD D(IS=1n)');
    const { circuit: next, conflicts } = paste(circuit, ['d']);
    expect(next.models).toHaveLength(1);
    expect(conflicts).toEqual([]);
  });

  it('keeps the card of the circuit when the same name differs, and says so', () => {
    const { circuit: next, conflicts } = paste(withImported('.model MYD D(IS=1n)'), ['d'], undefined, withImported('.model MYD D(IS=2n)'));
    expect(next.models).toEqual([{ name: 'MYD', card: '.model MYD D(IS=2n)' }]);
    expect(conflicts).toEqual(['MYD']);
  });
});

describe('clearOfCircuit', () => {
  // R1 goes from (0,-40) to (0,40) when turned, with a wire leaving its lower terminal to the left
  const circuit = (): Circuit => {
    const placed = place(emptyCircuit(), 'resistor', 'r', 0, 0);
    placed.elements[0].rot = 90;
    return { ...placed, wires: [{ id: 'w', pts: [{ x: -40, y: 40 }, { x: 0, y: 40 }] }] };
  };
  const move = { x: PASTE_STEP, y: PASTE_STEP };

  it('leaves a move that touches nothing', () => {
    const far = { x: 400, y: 400 };
    expect(clearOfCircuit(circuit(), copySelection(circuit(), new Set(['r', 'w']))!, far)).toEqual(far);
  });

  it('moves on when a wire of the copy would end on a terminal of the original', () => {
    const original = circuit();
    const clip = { elements: [], wires: [{ id: 'c', pts: [{ x: -40, y: -80 }, { x: -40, y: 0 }] }], models: [] };
    // Moved as it is, the free tip lands on the upper terminal of R1 and holds the copy there
    const landed = clip.wires[0].pts.map((p) => ({ x: p.x + move.x, y: p.y + move.y }));
    expect(anchoredWires([{ id: 'c', pts: landed }], [], [{ x: 0, y: -40 }]).has('c')).toBe(true);
    const clear = clearOfCircuit(original, clip, move);
    expect(clear).not.toEqual(move);
    const moved = clip.wires[0].pts.map((p) => ({ x: p.x + clear.x, y: p.y + clear.y }));
    expect(anchoredWires([{ id: 'c', pts: moved }], [], [{ x: 0, y: -40 }, { x: 0, y: 40 }, { x: -40, y: 40 }]).has('c')).toBe(false);
  });

  it('moves on when a terminal of the copy would land along a wire', () => {
    const original: Circuit = { ...emptyCircuit(), wires: [{ id: 'long', pts: [{ x: -200, y: 80 }, { x: 200, y: 80 }] }] };
    const part = place(emptyCircuit(), 'resistor', 'r', 0, 0);
    part.elements[0].rot = 90;
    // Its lower terminal would land on the long wire at y = 80
    const clip = copySelection(part, new Set(['r']))!;
    const clear = clearOfCircuit(original, clip, { x: 0, y: 40 });
    expect(clear).not.toEqual({ x: 0, y: 40 });
    expect(clear.y + 40 === 80 || clear.y - 40 === 80).toBe(false);
  });

  it('moves on when an end of the original would land along a wire of the copy', () => {
    const original: Circuit = { ...emptyCircuit(), wires: [{ id: 'short', pts: [{ x: 50, y: 40 }, { x: 50, y: 0 }] }] };
    const clip = { elements: [], wires: [{ id: 'c', pts: [{ x: -200, y: 0 }, { x: 200, y: 0 }] }], models: [] };
    expect(clearOfCircuit(original, clip, { x: 0, y: 0 })).not.toEqual({ x: 0, y: 0 });
  });

  it('allows wires that only cross', () => {
    const original: Circuit = { ...emptyCircuit(), wires: [{ id: 'v', pts: [{ x: 50, y: -100 }, { x: 50, y: 100 }] }] };
    const clip = { elements: [], wires: [{ id: 'h', pts: [{ x: 0, y: 0 }, { x: 100, y: 0 }] }], models: [] };
    expect(clearOfCircuit(original, clip, { x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
  });
});

describe('moveInView', () => {
  const clip = copySelection(twoResistors(), new Set(['a', 'b']))!;

  it('keeps the move when the copy lands in view', () => {
    expect(moveInView(clip, { x: 40, y: 40 }, { x1: -100, y1: -100, x2: 500, y2: 500 })).toEqual({ x: 40, y: 40 });
  });

  it('brings the copy to the middle of the view when it would land out of sight', () => {
    expect(moveInView(clip, { x: 40, y: 40 }, { x1: 1000, y1: 1000, x2: 1400, y2: 1200 })).toEqual({ x: 1150, y: 1100 });
  });
});

describe('moveToCenter', () => {
  it('brings the middle of the clip onto the point, on the grid', () => {
    const clip = copySelection(twoResistors(), new Set(['a', 'b']))!;
    expect(moveToCenter(clip, { x: 503, y: 298 })).toEqual({ x: 450, y: 300 });
  });
});
