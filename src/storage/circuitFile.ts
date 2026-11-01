import { getDevice } from '../library/devices';
import { normalizeModelCard } from '../library/modelImport';
import { Circuit, Element, Pt, Rotation, SpiceModel, Wire } from '../model/types';

const FORMAT = 'ee-sim-nextgen';
const VERSION = 1;
const AUTOSAVE_KEY = 'ee-sim-nextgen/circuit';
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

export const INVALID_FILE = 'Il file non è un circuito di EE_SIM_NextGen valido';
const NEWER_FILE = 'Il circuito è stato salvato da una versione più recente di EE_SIM_NextGen';

type Storable = Pick<Storage, 'getItem' | 'setItem'>;

export function serializeCircuit(circuit: Circuit): string {
  return JSON.stringify({ format: FORMAT, version: VERSION, circuit }, null, 2);
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

function parseElement(v: unknown): Element {
  const e = record(v);
  const def = text(e.def);
  if (!getDevice(def)) fail();
  const rot = number(e.rot);
  if (rot !== 0 && rot !== 90 && rot !== 180 && rot !== 270) fail();
  const props: Element['props'] = {};
  for (const [key, value] of Object.entries(record(e.props))) {
    props[key] = typeof value === 'number' ? number(value) : text(value);
  }
  return { id: text(e.id), def, x: number(e.x), y: number(e.y), rot: rot as Rotation, ...(e.flip === true ? { flip: true } : {}), tag: text(e.tag), props };
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
  const model = normalizeModelCard(text(m.card));
  return model && model.name === text(m.name) ? { name: model.name, card: model.card } : fail();
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
  if (number(file.version) > VERSION) throw new Error(NEWER_FILE);

  const c = record(file.circuit);
  const circuit: Circuit = {
    title: text(c.title),
    elements: list(c.elements).map(parseElement),
    wires: list(c.wires).map(parseWire),
    models: list(c.models).map(parseModel),
  };
  const ids = [...circuit.elements, ...circuit.wires].map((item) => item.id);
  if (new Set(ids).size !== ids.length) fail();
  return circuit;
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
