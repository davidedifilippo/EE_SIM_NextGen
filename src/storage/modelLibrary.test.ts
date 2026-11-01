import { describe, expect, it } from 'vitest';
import { circuitForSaving, findModel, modelsOfType, withLibraryModels } from '../library/models';
import { Circuit } from '../model/types';
import { generateNetlist } from '../netlist/generate';
import { compileCircuit } from '../realtime/compile';
import { halfWaveRectifier } from '../samples/halfWaveRectifier';
import { circuitFromNets } from '../realtime/testCircuits';
import { libraryAtStart, loadLibrary, mergeModels, saveLibrary } from './modelLibrary';

const memoryStorage = () => {
  const items = new Map<string, string>();
  return { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => void items.set(key, value) };
};

const A = { name: 'A', card: '.model A NPN(IS=1f BF=111)' };
const B = { name: 'B', card: '.model B NPN(IS=1f BF=222)' };
const P = { name: 'P', card: '.model P PNP(IS=1f BF=333)' };
const OWN_2N3904 = { name: '2N3904', card: '.model 2N3904 NPN(IS=1f BF=444)' };

const withTransistor = (model: string, models = [] as Circuit['models']): Circuit => {
  const circuit = circuitFromNets('t', [{ def: 'npn', tag: 'Q1', nets: ['c', 'b', '0'], props: { model } }]);
  return { ...circuit, models };
};

describe('library storage', () => {
  it('remembers the models', () => {
    const storage = memoryStorage();
    expect(loadLibrary(storage)).toEqual([]);
    expect(saveLibrary([A, B], storage)).toBe(true);
    expect(loadLibrary(storage)).toEqual([A, B]);
  });

  it.each([
    ['broken text', '{'],
    ['not a list', '{"a":1}'],
  ])('survives %s', (_, text) => {
    const storage = memoryStorage();
    storage.setItem('ee-sim-nextgen/models', text);
    expect(loadLibrary(storage)).toEqual([]);
  });

  it('cleans what it reads, and drops what is not a model', () => {
    const storage = memoryStorage();
    storage.setItem('ee-sim-nextgen/models', JSON.stringify([{ name: 'A', card: '.model A NPN(BF=1 mfg=X)' }, { name: 'X', card: 'R1 a b 1k' }, 3, null]));
    expect(loadLibrary(storage)).toEqual([{ name: 'A', card: '.model A NPN(BF=1)' }]);
  });

  it('says when it could not keep them', () => {
    const storage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('full');
      },
    };
    expect(saveLibrary([A], storage)).toBe(false);
  });

  it('lets an import update a model', () => {
    const newer = { name: 'A', card: '.model A NPN(BF=9)' };
    expect(mergeModels([A, B], [newer])).toEqual([B, newer]);
  });
});

describe('libraryAtStart', () => {
  const carrying = (...models: Circuit['models']): Circuit => ({ ...halfWaveRectifier(), models: [...halfWaveRectifier().models, ...models] });

  it('the first time, adopts what the circuit carries, except built-in copies and empty models', () => {
    const storage = memoryStorage();
    expect(libraryAtStart(carrying(A, B, { name: 'Transistor', card: '.model Transistor NPN()' }), storage)).toEqual([A, B]);
    expect(loadLibrary(storage)).toEqual([A, B]);
  });

  it('remembers it has been done even when there was nothing to adopt', () => {
    const storage = memoryStorage();
    expect(libraryAtStart(halfWaveRectifier(), storage)).toEqual([]);
    expect(libraryAtStart(carrying(A), storage)).toEqual([]);
  });

  it('afterwards, a circuit does not fill the library, and a removed model stays removed', () => {
    const storage = memoryStorage();
    saveLibrary([B], storage);
    expect(libraryAtStart(carrying(A), storage)).toEqual([B]);
  });

  it('works without storage', () => {
    const storage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(libraryAtStart(carrying(A), storage)).toEqual([]);
  });
});

describe('models in the menu', () => {
  it('lists the circuit, then the library, then the built-in ones, once each', () => {
    const circuit = withTransistor('A', [OWN_2N3904]);
    const names = modelsOfType(circuit, 'NPN', [A, { name: '2N3904', card: '.model 2N3904 NPN(BF=1)' }]).map((m) => m.name);
    expect(names).toEqual(['2N3904', 'A']);
    expect(modelsOfType(circuit, 'PNP', [P]).map((m) => m.name)).toEqual(['P', '2N3906']);
  });
});

describe('withLibraryModels', () => {
  it('gives the engines the library model a part uses, and only that', () => {
    const resolved = withLibraryModels(withTransistor('A'), [A, B]);
    expect(resolved.models).toEqual([A]);
    expect(compileCircuit(resolved).ok).toBe(true);
    expect(generateNetlist(resolved, { type: 'tran', step: '1u', stop: '1m' }).text).toContain(A.card);
  });

  it('makes the library win over a built-in model of the same name', () => {
    const mine = { name: '2N3904', card: '.model 2N3904 NPN(BF=7)' };
    expect(findModel(withLibraryModels(withTransistor('2N3904'), [mine]), '2N3904')).toEqual(mine);
  });

  it('leaves alone a model the circuit already has', () => {
    const resolved = withLibraryModels(withTransistor('2N3904', [OWN_2N3904]), [{ name: '2N3904', card: '.model 2N3904 NPN(BF=7)' }]);
    expect(findModel(resolved, '2N3904')).toEqual(OWN_2N3904);
  });

  it('returns the same circuit when there is nothing to add', () => {
    const circuit = withTransistor('2N3904');
    expect(withLibraryModels(circuit, [A])).toBe(circuit);
  });

  it('without the library, a part reports its missing model', () => {
    expect(compileCircuit(withTransistor('A')).ok).toBe(false);
  });
});

describe('circuitForSaving', () => {
  it('keeps only the used models, wherever they come from', () => {
    const circuit: Circuit = {
      ...circuitFromNets('t', [
        { def: 'npn', tag: 'Q1', nets: ['c', 'b', '0'], props: { model: 'A' } },
        { def: 'npn', tag: 'Q2', nets: ['c', 'b', '0'], props: { model: 'A' } },
        { def: 'pnp', tag: 'Q3', nets: ['c', 'b', '0'], props: { model: '2N3906' } },
        { def: 'npn', tag: 'Q4', nets: ['c', 'b', '0'], props: { model: '2N3904' } },
      ]),
      models: [OWN_2N3904, B],
    };
    const saved = circuitForSaving(circuit, [A, P]);
    expect(saved.models.map((m) => m.name)).toEqual(['A', '2N3906', '2N3904']);
    expect(saved.models[2]).toEqual(OWN_2N3904);
  });

  it('lets a saved circuit work where the library is empty', () => {
    const saved = circuitForSaving(withTransistor('A'), [A]);
    expect(compileCircuit(saved).ok).toBe(true);
  });

  it('skips a name nobody defines, so the error still shows', () => {
    expect(circuitForSaving(withTransistor('NOPE'), []).models).toEqual([]);
  });
});
