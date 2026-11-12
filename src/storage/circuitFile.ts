import { canRotate, getDevice } from '../library/devices';
import { cleanStoredCard } from '../library/modelImport';
import { BlockDef, Circuit, Element, Pt, Rotation, SpiceModel, Wire } from '../model/types';
import { createBlock, isBlockId, registerBlocks } from '../library/blocks';

const FORMAT = 'ee-sim-nextgen';
/**
 * 2 since the blocks; a circuit without them is still written as 1, for the versions before them. 3 was
 * written for a while by the edition with the breadboard: it opens as well, without the breadboard.
 */
const VERSION = 2;
const LAST_READ = 3;
const AUTOSAVE_KEY = 'ee-sim-nextgen/circuit';
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

export const INVALID_FILE = 'Il file non è un circuito di EE_SIM_NextGen valido';
const NEWER_FILE = 'Il circuito è stato salvato da una versione più recente di EE_SIM_NextGen';

type Storable = Pick<Storage, 'getItem' | 'setItem'>;

/** Indented for a file someone may open; without spaces for a link, where every character counts. */
export function serializeCircuit(circuit: Circuit, indent = 2): string {
  const { ties: _, ...saved } = circuit;
  return JSON.stringify({ format: FORMAT, version: saved.blocks?.length ? VERSION : 1, circuit: saved }, null, indent);
}

const fail = (): never => {
  throw new Error(INVALID_FILE);
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const number = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : fail());
const text = (v: unknown): string => (typeof v === 'string' ? v : fail());
const record = (v: unknown): Record<string, unknown> => (isRecord(v) ? v : fail());
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : fail());

function parsePoint(v: unknown): Pt {
  const p = record(v);
  return { x: number(p.x), y: number(p.y) };
}

/** remap gives the id each block of the file has here, worked out again from its content. */
function parseElement(v: unknown, remap: Map<string, string>): Element {
  const e = record(v);
  const def = remap.get(text(e.def)) ?? text(e.def);
  if (isBlockId(def) && ![...remap.values()].includes(def)) fail();
  if (!getDevice(def)) fail();
  const rot = number(e.rot);
  if (rot !== 0 && rot !== 90 && rot !== 180 && rot !== 270) fail();
  const props: Element['props'] = {};
  for (const [key, value] of Object.entries(record(e.props))) {
    props[key] = typeof value === 'number' ? number(value) : text(value);
  }
  return {
    id: text(e.id),
    def,
    x: number(e.x),
    y: number(e.y),
    rot: (canRotate(getDevice(def)) ? rot : 0) as Rotation,
    ...(e.flip === true ? { flip: true } : {}),
    tag: text(e.tag),
    props,
  };
}

function parseWire(v: unknown): Wire {
  const w = record(v);
  const pts = list(w.pts).map(parsePoint);
  if (pts.length < 2) fail();
  return { id: text(w.id), pts };
}

/** A card goes straight to ngspice, so a saved one gets the same cleaning as an imported one. */
function parseModel(v: unknown): SpiceModel {
  const m = record(v);
  const model = cleanStoredCard(text(m.card));
  return model && model.name === text(m.name) ? model : fail();
}

/** Reads a saved circuit, keeping only known fields. A file comes from outside: nothing in it is trusted. */
export function parseCircuitFile(content: string): Circuit {
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    return fail();
  }
  const file = record(data);
  if (file.format !== FORMAT) fail();
  if (number(file.version) > LAST_READ) throw new Error(NEWER_FILE);

  const c = record(file.circuit);
  const remap = new Map<string, string>();
  const blocks = c.blocks === undefined ? [] : parseBlocks(list(c.blocks), remap);
  const circuit: Circuit = { ...parseBody(c, remap), ...(blocks.length > 0 ? { blocks } : {}) };
  registerBlocks(blocks);
  return circuit;
}

function parseBody(c: Record<string, unknown>, remap: Map<string, string>): Circuit {
  const circuit: Circuit = {
    title: text(c.title),
    elements: list(c.elements).map((v) => parseElement(v, remap)),
    wires: list(c.wires).map(parseWire),
    models: list(c.models).map(parseModel),
  };
  const ids = [...circuit.elements, ...circuit.wires].map((item) => item.id);
  if (new Set(ids).size !== ids.length || ids.some((id) => id.includes('/'))) fail();
  return circuit;
}

/**
 * The blocks of a file, each read as a circuit of its own, a block inside another before it. The id of each
 * is worked out again from what it contains: nothing in the file can pass for a block it is not.
 */
function parseBlocks(raw: unknown[], remap: Map<string, string>): BlockDef[] {
  const pending = raw.map((v) => {
    const b = record(v);
    const body = record(b.circuit);
    const uses = list(body.elements).flatMap((e) => {
      const def = text(record(e).def);
      return isBlockId(def) ? [def] : [];
    });
    return { id: text(b.id), name: text(b.name).trim() || fail(), body, uses };
  });
  const blocks: BlockDef[] = [];
  while (pending.length > 0) {
    const ready = pending.findIndex((b) => b.uses.every((id) => remap.has(id)));
    // A block that needs one the file does not have, or blocks inside each other in a ring
    if (ready < 0) fail();
    const [b] = pending.splice(ready, 1);
    const [block] = createBlock(b.name, parseBody(b.body, remap));
    if (remap.has(b.id)) fail();
    remap.set(b.id, block.id);
    blocks.push(block);
  }
  return blocks;
}

/** Storage can be missing or full, as in a private window: the app then simply does not remember. */
export function saveAutosave(circuit: Circuit, storage: Storable = localStorage) {
  try {
    storage.setItem(AUTOSAVE_KEY, serializeCircuit(circuit));
  } catch {
    // Nothing to do: the circuit on screen is unaffected
  }
}

export function loadAutosave(storage: Storable = localStorage): Circuit | null {
  try {
    const saved = storage.getItem(AUTOSAVE_KEY);
    return saved ? parseCircuitFile(saved) : null;
  } catch {
    return null;
  }
}

export function circuitFileName(circuit: Circuit): string {
  const name = circuit.title.trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
  return `${name || 'circuito'}.json`;
}

export function downloadCircuit(circuit: Circuit) {
  const url = URL.createObjectURL(new Blob([serializeCircuit(circuit)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = circuitFileName(circuit);
  link.click();
  URL.revokeObjectURL(url);
}
