import { BlockDef, Circuit, ComponentDef, Element, SpiceModel, Wire } from '../model/types';
import { terminalKey } from '../netlist/connectivity';
import { getDevice, registerDevice, tableBox } from './devices';

/**
 * Blocks: whole circuits used as parts. The flags inside are the pins, on the left or on the right of the
 * box. Before either engine sees a circuit, each block is opened into its parts: the engines then simulate
 * an ordinary circuit, whatever is inside.
 */

export const BLOCK_PREFIX = 'block:';
export const isBlockId = (id: string) => id.startsWith(BLOCK_PREFIX);

/** Every block met in this session, by id: what a circuit uses is always found here. */
const known = new Map<string, BlockDef>();

/** FNV-1a, twice with different seeds: an id from the content, 16 hex digits. */
function contentHash(text: string): string {
  const hash = (seed: number) => {
    let h = seed >>> 0;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  };
  return hash(0x811c9dc5) + hash(0x01234567);
}

/** JSON with the keys of every object in order: the same content gives the same text, however it was built. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
    return `{${entries
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export interface BlockPins {
  left: string[];
  right: string[];
}

const isPort = (el: Element) => el.def === 'port_in' || el.def === 'port_out';

/** The pins of a schematic, from the top down on each side as its flags are drawn. */
export function blockPins(circuit: Circuit): BlockPins {
  const side = (def: string) =>
    circuit.elements
      .filter((el) => el.def === def)
      .sort((a, b) => a.y - b.y || a.x - b.x)
      .map((el) => el.tag);
  return { left: side('port_in'), right: side('port_out') };
}

/** What keeps a schematic from being a block, or null if it can be one. */
export function blockProblem(circuit: Circuit): string | null {
  const { left, right } = blockPins(circuit);
  const names = [...left, ...right];
  if (names.length === 0) return 'Il circuito non ha piedini: aggiungi le bandierine "Piedino a sinistra" o "Piedino a destra" dalla sezione Blocchi';
  if (names.some((name) => !/^[A-Za-z0-9_+-]{1,12}$/.test(name))) return 'Ogni piedino vuole un nome di lettere e cifre, fino a 12';
  const seen = new Set<string>();
  for (const name of names) {
    if (seen.has(name.toUpperCase())) return `Due piedini si chiamano "${name}"`;
    seen.add(name.toUpperCase());
  }
  return null;
}

/** The part of a block: a box with the pins outside; its name is written beside it. */
function blockDevice(block: BlockDef): ComponentDef {
  const { left, right } = blockPins(block.circuit);
  return {
    id: block.id,
    category: 'Blocchi',
    name: block.name,
    tagPrefix: 'X',
    searchTerms: `blocco ${block.name.toLowerCase()}`,
    ...tableBox(left, right),
    props: [],
    spice: { kind: 'userblock', blockId: block.id },
  };
}

/** Makes the blocks known, to the parts of the app and to this module. */
export function registerBlocks(blocks: BlockDef[] | undefined) {
  for (const block of blocks ?? []) {
    if (known.has(block.id)) continue;
    known.set(block.id, block);
    registerDevice(blockDevice(block));
  }
}

export const knownBlock = (id: string) => known.get(id) ?? null;

/** The ids of the blocks a circuit uses, those inside its blocks too. */
export function usedBlockIds(circuit: Circuit, into = new Set<string>()): Set<string> {
  for (const el of circuit.elements) {
    if (!isBlockId(el.def) || into.has(el.def)) continue;
    into.add(el.def);
    const block = known.get(el.def);
    if (block) usedBlockIds(block.circuit, into);
  }
  return into;
}

/** The circuit carrying the blocks it uses and no others, so that a file or a link works anywhere. */
export function withUsedBlocks(circuit: Circuit): Circuit {
  registerBlocks(circuit.blocks);
  const ids = [...usedBlockIds(circuit)];
  const blocks = ids.flatMap((id) => (known.has(id) ? [known.get(id)!] : []));
  const before = circuit.blocks ?? [];
  if (blocks.length === before.length && blocks.every((b, k) => b.id === before[k].id)) return circuit;
  if (blocks.length === 0) {
    const { blocks: _, ...rest } = circuit;
    return rest;
  }
  return { ...circuit, blocks };
}

/**
 * A block from a schematic: its own blocks come along beside it, never inside, and its id from its content.
 * The first of the list is the new block.
 */
export function createBlock(name: string, schematic: Circuit): BlockDef[] {
  registerBlocks(schematic.blocks);
  const inner: Circuit = { title: name, elements: schematic.elements, wires: schematic.wires, models: schematic.models };
  const id = BLOCK_PREFIX + contentHash(canonical([name, inner.elements, inner.wires, inner.models]));
  const block: BlockDef = { id, name, circuit: inner };
  const nested = [...usedBlockIds(inner)].flatMap((other) => (known.has(other) ? [known.get(other)!] : []));
  registerBlocks([block]);
  return [block, ...nested];
}

/** Far enough apart that nothing inside one block ever touches anything else. */
const REGION = 1e6;

/** The models of a block that the circuit does not have under the same name. */
const mergeModels = (own: SpiceModel[], added: SpiceModel[]) => {
  const names = new Set(own.map((m) => m.name));
  return [...own, ...added.filter((m) => !names.has(m.name))];
};

/**
 * The circuit with every block opened into its parts, those inside blocks within blocks too. The parts of
 * block X1 become X1/R1 and so on, named X1_R1 for ngspice, and are moved to a region of their own; each pin
 * of the block is tied to its flag inside. The block itself stays, as the flags do, with no device of its
 * own. A circuit without blocks comes back as it is.
 */
export function flattenBlocks(circuit: Circuit): Circuit {
  // Already opened: the ties say so, even an empty list
  if (circuit.ties !== undefined || !circuit.elements.some((el) => isBlockId(el.def))) return circuit;
  registerBlocks(circuit.blocks);
  const counter = { next: 0 };
  const opened = open(circuit, counter);
  return { ...circuit, ...opened };
}

function open(circuit: Circuit, counter: { next: number }): Pick<Circuit, 'elements' | 'wires' | 'models' | 'ties'> {
  const elements: Element[] = [];
  const wires: Wire[] = [...circuit.wires];
  const ties: [string, string][] = [...(circuit.ties ?? [])];
  let models = circuit.models;
  for (const el of circuit.elements) {
    elements.push(el);
    if (!isBlockId(el.def)) continue;
    const block = known.get(el.def);
    if (!block) continue;
    // Moved first, so that the blocks inside it go to regions of their own
    const dx = ++counter.next * REGION;
    const moved: Circuit = {
      ...block.circuit,
      elements: block.circuit.elements.map((inner) => ({ ...inner, x: inner.x + dx })),
      wires: block.circuit.wires.map((w) => ({ ...w, pts: w.pts.map((p) => ({ x: p.x + dx, y: p.y })) })),
    };
    const inside = open(moved, counter);
    const prefix = `${el.id}/`;
    const renamed = (key: string) => prefix + key;
    for (const inner of inside.elements) elements.push({ ...inner, id: renamed(inner.id), tag: `${el.tag}_${inner.tag}` });
    for (const w of inside.wires) wires.push({ ...w, id: renamed(w.id) });
    for (const [a, b] of inside.ties ?? []) ties.push([renamed(a), renamed(b)]);
    for (const inner of block.circuit.elements) {
      if (isPort(inner)) ties.push([terminalKey(el.id, inner.tag), renamed(terminalKey(inner.id, 'p'))]);
    }
    models = mergeModels(models, inside.models);
  }
  return { elements, wires, models, ties };
}

/** Whether an element of an opened circuit is a part inside a block. */
export const isInsideBlock = (elementId: string) => elementId.includes('/');

/** The device of a block as a part, for the library and the properties. */
export const blockDef = (id: string) => (isBlockId(id) ? getDevice(id) ?? null : null);
