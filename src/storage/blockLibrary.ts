import { BlockDef } from '../model/types';
import { parseCircuitFile, serializeCircuit } from './circuitFile';

const LIBRARY_KEY = 'ee-sim-nextgen/blocks';

type Storable = Pick<Storage, 'getItem' | 'setItem'>;

/**
 * The personal blocks, kept as a circuit with no parts and only blocks: what is stored goes through the
 * same checks as a file, since storage can be edited.
 */
export function loadBlockLibrary(storage: Storable = localStorage): BlockDef[] {
  try {
    const stored = storage.getItem(LIBRARY_KEY);
    return stored ? (parseCircuitFile(stored).blocks ?? []) : [];
  } catch {
    return [];
  }
}

/** False if the library could not be kept, as in a private window: it then lasts until the page closes. */
export function saveBlockLibrary(blocks: BlockDef[], storage: Storable = localStorage): boolean {
  try {
    storage.setItem(LIBRARY_KEY, serializeCircuit({ title: '', elements: [], wires: [], models: [], blocks }, 0));
    return true;
  } catch {
    return false;
  }
}

/**
 * Adds blocks, the first being the new one and the others those inside it. A block with the name of the new
 * one takes its place: circuits that use the old one keep their own copy.
 */
export function addToBlockLibrary(library: BlockDef[], added: BlockDef[]): BlockDef[] {
  const [main] = added;
  const ids = new Set(added.map((b) => b.id));
  return [...library.filter((b) => !ids.has(b.id) && b.name !== main?.name), ...added];
}
