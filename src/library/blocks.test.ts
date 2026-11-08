import { describe, expect, it } from 'vitest';
import { runTransient } from '../engine/ngspice';
import { Circuit, Element, Rotation, Wire } from '../model/types';
import { computeConnectivity, terminalKey } from '../netlist/connectivity';
import { generateNetlist } from '../netlist/generate';
import { compileCircuit } from '../realtime/compile';
import { RealtimeEngine } from '../realtime/engine';
import { buildLiveLayout, LiveSimulation } from '../realtime/liveSimulation';
import { blockPins, blockProblem, createBlock, flattenBlocks, withUsedBlocks } from './blocks';
import { getDevice } from './devices';
import { replaceWithBlock, selectionBoundary } from './blockFromSelection';
import { parseCircuitFile, serializeCircuit } from '../storage/circuitFile';
import { addToBlockLibrary, loadBlockLibrary, saveBlockLibrary } from '../storage/blockLibrary';

const part = (id: string, def: string, x: number, y: number, rot: Rotation, tag: string, props: Record<string, string> = {}): Element => ({
  id,
  def,
  x,
  y,
  rot,
  tag,
  props: { ...Object.fromEntries((getDevice(def)?.props ?? []).map((p) => [p.key, p.default])), ...props },
});
const wire = (id: string, ...pts: [number, number][]): Wire => ({ id, pts: pts.map(([x, y]) => ({ x, y })) });
const circuit = (elements: Element[], wires: Wire[], extra: Partial<Circuit> = {}): Circuit => ({ title: 't', elements, wires, models: [], ...extra });

/** IN, R1 1k to OUT, R2 1k from OUT to ground inside. */
const dividerSchematic = () =>
  circuit(
    [
      part('pin', 'port_in', -100, 0, 0, 'IN'),
      part('r1', 'resistor', 0, 0, 0, 'R1', { value: '1k' }),
      part('r2', 'resistor', 40, 60, 90, 'R2', { value: '1k' }),
      part('g', 'ground', 40, 100, 0, ''),
      part('pout', 'port_out', 100, 0, 0, 'OUT'),
    ],
    [wire('a', [-100, 0], [-40, 0]), wire('b', [40, 0], [100, 0]), wire('c', [40, 0], [40, 20])],
  );

/** 10 V into the block at (200, 0); a load of 1k on OUT. The block pins are at (160, 0) and (240, 0). */
function withBlock(def: string, extra: Partial<Circuit>) {
  return circuit(
    [
      part('v1', 'dcsupply', 0, 40, 90, 'V1', { amplitude: '10' }),
      part('g', 'ground', 0, 80, 0, ''),
      part('x1', def, 200, 0, 0, 'X1'),
      part('r3', 'resistor', 300, 40, 90, 'R3', { value: '1k' }),
    ],
    [wire('w1', [0, 0], [160, 0]), wire('w2', [240, 0], [300, 0]), wire('w3', [300, 80], [0, 80])],
    extra,
  );
}

/** 1k || 1k below 1k: a third of 10 V. */
const EXPECTED = 10 / 3;

function operate(c: Circuit, terminal: [string, string]) {
  const compiled = compileCircuit(c);
  if (!compiled.ok) throw new Error(compiled.errors.join('; '));
  const engine = new RealtimeEngine(compiled.compiled);
  engine.initialize();
  const net = computeConnectivity(flattenBlocks(c)).netOf.get(terminalKey(...terminal))!;
  return engine.nodeVoltage(compiled.compiled.netIndex.get(net)!);
}

async function ngspice(c: Circuit, terminal: [string, string]) {
  const netlist = generateNetlist(c, { type: 'tran', step: '1u', stop: '10u' });
  expect(netlist.errors).toEqual([]);
  const result = await runTransient(netlist.text);
  const values = result.voltages.get(netlist.nodeOf.get(terminalKey(...terminal))!)!;
  return values[values.length - 1];
}

describe('a block made of a whole circuit', () => {
  it('takes its pins from the flags, left and right', () => {
    expect(blockPins(dividerSchematic())).toEqual({ left: ['IN'], right: ['OUT'] });
    expect(blockProblem(dividerSchematic())).toBeNull();
    expect(blockProblem(circuit([], []))).toMatch(/piedini/);
    const twice = dividerSchematic();
    twice.elements[4] = { ...twice.elements[4], tag: 'IN' };
    expect(blockProblem(twice)).toMatch(/Due piedini/);
  });

  it('gets an id from its content, and a box with its pins', () => {
    const [a] = createBlock('Partitore', dividerSchematic());
    const [b] = createBlock('Partitore', dividerSchematic());
    const [c] = createBlock('Partitore 2', dividerSchematic());
    expect(a.id).toBe(b.id);
    expect(c.id).not.toBe(a.id);
    expect(getDevice(a.id)?.terminals).toEqual([
      { id: 'IN', x: -40, y: 0 },
      { id: 'OUT', x: 40, y: 0 },
    ]);
  });

  it('gives the same voltages as the circuit drawn without it, in both engines', async () => {
    const blocks = createBlock('Partitore', dividerSchematic());
    const c = withBlock(blocks[0].id, { blocks });
    const out = operate(c, ['x1', 'OUT']);
    expect(out).toBeCloseTo(EXPECTED, 6);
    expect(await ngspice(c, ['x1', 'OUT'])).toBeCloseTo(out, 4);
    // The parts inside are named after the block for ngspice
    expect(generateNetlist(c, { type: 'tran', step: '1u', stop: '10u' }).text).toMatch(/^RX1_R1 /m);
  });

  it('opens a block inside a block, in both engines', async () => {
    const [divider] = createBlock('Partitore', dividerSchematic());
    // The outer block: its own flags around the divider
    const outer = circuit(
      [part('i', 'port_in', 100, 0, 0, 'A'), part('d', divider.id, 200, 0, 0, 'X1'), part('o', 'port_out', 300, 0, 0, 'B')],
      [wire('a', [100, 0], [160, 0]), wire('b', [240, 0], [300, 0])],
      { blocks: [divider] },
    );
    const blocks = createBlock('Esterno', outer);
    expect(blocks.map((b) => b.name)).toEqual(['Esterno', 'Partitore']);
    const c = withBlock(blocks[0].id, { blocks });
    const out = operate(c, ['x1', 'B']);
    expect(out).toBeCloseTo(EXPECTED, 6);
    expect(await ngspice(c, ['x1', 'B'])).toBeCloseTo(out, 4);
  });

  it('carries only the blocks it uses', () => {
    const [divider] = createBlock('Partitore', dividerSchematic());
    const [other] = createBlock('Altro', dividerSchematic());
    const c = withBlock(divider.id, { blocks: [divider, other] });
    expect(withUsedBlocks(c).blocks?.map((b) => b.name)).toEqual(['Partitore']);
    expect(withUsedBlocks({ ...c, elements: c.elements.filter((el) => el.id !== 'x1') }).blocks).toBeUndefined();
  });

  it('in the animation, the current of the wires reaches the pins of the block', () => {
    const blocks = createBlock('Partitore', dividerSchematic());
    const c = withBlock(blocks[0].id, { blocks });
    const sim = new LiveSimulation();
    expect(sim.load(c)).toEqual({ ok: true });
    sim.advance(10, 1e-5, 1e6);
    const frame = sim.frame()!;
    const compiled = compileCircuit(c);
    if (!compiled.ok) throw new Error('not compiled');
    // As the main thread builds it
    const layout = buildLiveLayout(c, compiled.compiled);
    // Only the wires of the sheet are drawn, and the parts inside get no dots
    expect(new Set(layout.graph.edges.map((e) => e.wireId))).toEqual(new Set(['w1', 'w2', 'w3']));
    expect(layout.devices.filter((d) => d.firstDot < 0)).toHaveLength(2);
    // Into IN: 10 V over 1k + 1k || 1k; out of OUT into the load: half of that
    const along = (id: string) => layout.graph.edges.flatMap((e, k) => (e.wireId === id ? [Math.abs(frame.edgeCurrent[k])] : []));
    for (const i of along('w1')) expect(i).toBeCloseTo(10 / 1500, 6);
    for (const i of along('w2')) expect(i).toBeCloseTo(10 / 3000, 6);
  });
});

/** The divider drawn flat: V1, R1 from (120, 0) to (200, 0), R2 and its ground below, the load R3. */
const flatDivider = () =>
  circuit(
    [
      part('v1', 'dcsupply', 0, 40, 90, 'V1', { amplitude: '10' }),
      part('g', 'ground', 0, 80, 0, ''),
      part('r1', 'resistor', 160, 0, 0, 'R1', { value: '1k' }),
      part('r2', 'resistor', 240, 40, 90, 'R2', { value: '1k' }),
      part('g2', 'ground', 240, 80, 0, ''),
      part('r3', 'resistor', 300, 40, 90, 'R3', { value: '1k' }),
    ],
    [wire('w1', [0, 0], [120, 0]), wire('w2', [200, 0], [300, 0]), wire('w3', [300, 80], [0, 80])],
  );

describe('a block from the selection', () => {
  const selected = new Set(['r1', 'r2', 'g2']);

  it('has a pin for each node joining the selection to the rest, and none for ground', () => {
    const boundary = selectionBoundary(flatDivider(), selected)!;
    // R1 and R2 meet only through the wire to R3, left outside: a pin each
    expect(boundary.pins).toEqual([
      { name: 'P1', side: 'left', at: { x: 120, y: 0 } },
      { name: 'P2', side: 'right', at: { x: 200, y: 0 } },
      { name: 'P3', side: 'right', at: { x: 240, y: 0 } },
    ]);
    expect(boundary.groundsToAdd).toEqual([]);
  });

  it('gives the same voltages after as before, in both engines', async () => {
    const before = flatDivider();
    const pins = selectionBoundary(before, selected)!.pins.map((p, k) => ({ ...p, name: ['IN', 'OUT', 'OUT2'][k] }));
    const result = replaceWithBlock(before, selected, 'Partitore', pins, 1);
    if ('error' in result) throw new Error(result.error);
    const after = result.circuit;
    expect(after.elements.map((el) => el.tag)).toEqual(['V1', '', 'R3', 'X1']);
    expect(operate(before, ['r3', 'a'])).toBeCloseTo(EXPECTED, 6);
    expect(operate(after, ['r3', 'a'])).toBeCloseTo(EXPECTED, 6);
    expect(await ngspice(after, ['r3', 'a'])).toBeCloseTo(EXPECTED, 4);
  });

  it('says what is wrong with the pins', () => {
    const pins = selectionBoundary(flatDivider(), selected)!.pins.map((p) => ({ ...p, name: 'A' }));
    expect(replaceWithBlock(flatDivider(), selected, 'Partitore', pins, 1)).toEqual({ error: 'Due piedini si chiamano "A"' });
    expect(replaceWithBlock(flatDivider(), new Set(), 'Partitore', [], 1)).toEqual({ error: 'Seleziona almeno un componente' });
  });
});

describe('blocks in files and in the library', () => {
  it('go to a file and come back, blocks inside blocks too', () => {
    const [divider] = createBlock('Partitore', dividerSchematic());
    const outer = circuit(
      [part('i', 'port_in', 100, 0, 0, 'A'), part('d', divider.id, 200, 0, 0, 'X1'), part('o', 'port_out', 300, 0, 0, 'B')],
      [wire('a', [100, 0], [160, 0]), wire('b', [240, 0], [300, 0])],
      { blocks: [divider] },
    );
    const blocks = createBlock('Esterno', outer);
    const c = withBlock(blocks[0].id, { blocks });
    const back = parseCircuitFile(serializeCircuit(c));
    // A block inside another comes first in what is read back
    const byId = (x: Circuit) => ({ ...x, blocks: [...(x.blocks ?? [])].sort((a, b) => a.id.localeCompare(b.id)) });
    expect(byId(back)).toEqual(byId(c));
    expect(JSON.parse(serializeCircuit(c)).version).toBe(2);
    expect(JSON.parse(serializeCircuit(flatDivider())).version).toBe(1);
  });

  it('refuse a block that is not what it claims, or that needs one the file lacks', () => {
    const blocks = createBlock('Partitore', dividerSchematic());
    const text = serializeCircuit(withBlock(blocks[0].id, { blocks }));
    // Another content under the same id: it gets an id of its own, and the circuit follows it
    const changed = parseCircuitFile(text.replace(/("blocks"[\s\S]*?)"1k"/, '$1"2k"'));
    expect(changed.blocks![0].id).not.toBe(blocks[0].id);
    expect(changed.elements.find((el) => el.id === 'x1')!.def).toBe(changed.blocks![0].id);
    // A block used but not carried
    expect(() => parseCircuitFile(serializeCircuit({ ...withBlock(blocks[0].id, {}), blocks: [] }))).toThrow();
  });

  it('keep the personal blocks in the browser, a new one with the same name in place of the old', () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    const first = createBlock('Partitore', dividerSchematic());
    const changed = dividerSchematic();
    changed.elements[1] = { ...changed.elements[1], props: { value: '2k' } };
    const second = createBlock('Partitore', changed);
    const library = addToBlockLibrary(addToBlockLibrary([], first), second);
    expect(library.map((b) => b.id)).toEqual([second[0].id]);
    expect(saveBlockLibrary(library, storage)).toBe(true);
    expect(loadBlockLibrary(storage)).toEqual(library);
  });
});
