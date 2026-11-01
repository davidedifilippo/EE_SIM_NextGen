import { normalizeModelCard } from '../library/modelImport';
import { isBuiltInModel } from '../library/models';
import { Circuit, SpiceModel } from '../model/types';

const LIBRARY_KEY = 'ee-sim-nextgen/models';

type Storable = Pick<Storage, 'getItem' | 'setItem'>;

/** The later list wins on equal names, so importing a model again updates it. */
export function mergeModels(base: SpiceModel[], added: SpiceModel[]): SpiceModel[] {
  const names = new Set(added.map((m) => m.name));
  return [...base.filter((m) => !names.has(m.name)), ...added];
}

/** Whatever is stored went through the importer once, but storage can be edited: it gets the same cleaning. */
export function loadLibrary(storage: Storable = localStorage): SpiceModel[] {
  try {
    const stored: unknown = JSON.parse(storage.getItem(LIBRARY_KEY) ?? '[]');
    if (!Array.isArray(stored)) return [];
    return stored.flatMap((item): SpiceModel[] => {
      const model = typeof item?.card === 'string' ? normalizeModelCard(item.card) : null;
      return model ? [{ name: model.name, card: model.card }] : [];
    });
  } catch {
    return [];
  }
}

/** False if the library could not be kept, as in a private window: it then lasts until the page closes. */
export function saveLibrary(models: SpiceModel[], storage: Storable = localStorage): boolean {
  try {
    storage.setItem(LIBRARY_KEY, JSON.stringify(models));
    return true;
  } catch {
    return false;
  }
}

/**
 * The first time only: circuits used to carry every imported model, and those of the last session
 * move to the library, so that keeping only the used ones in the circuit loses nothing. Later on a
 * circuit's models stay its own: a file opened once must not fill the library, and a model taken
 * out of it must not come back.
 */
export function libraryAtStart(circuit: Circuit, storage: Storable = localStorage): SpiceModel[] {
  try {
    if (storage.getItem(LIBRARY_KEY) !== null) return loadLibrary(storage);
  } catch {
    return [];
  }
  const adopted = circuit.models.filter((m) => !isBuiltInModel(m) && /\(\s*[^)\s]/.test(m.card));
  saveLibrary(adopted, storage);
  return adopted;
}
