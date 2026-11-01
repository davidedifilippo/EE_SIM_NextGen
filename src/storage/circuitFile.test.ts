import { describe, expect, it } from 'vitest';
import { generateNetlist } from '../netlist/generate';
import { halfWaveRectifier } from '../samples/halfWaveRectifier';
import { circuitFileName, INVALID_FILE, loadAutosave, parseCircuitFile, saveAutosave, serializeCircuit } from './circuitFile';

const memoryStorage = () => {
  const items = new Map<string, string>();
  return { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => void items.set(key, value) };
};

const edited = (change: (file: { format: string; version: number; circuit: ReturnType<typeof halfWaveRectifier> }) => void) => {
  const file = JSON.parse(serializeCircuit(halfWaveRectifier()));
  change(file);
  return JSON.stringify(file);
};

describe('circuit file', () => {
  it('gives back the same circuit and the same netlist', () => {
    const circuit = halfWaveRectifier({ capacitor: '100u' });
    const read = parseCircuitFile(serializeCircuit(circuit));
    const analysis = { type: 'tran', step: '20u', stop: '100m' } as const;
    expect(read).toEqual(circuit);
    expect(generateNetlist(read, analysis).text).toBe(generateNetlist(circuit, analysis).text);
  });

  it('drops the fields it does not know', () => {
    const read = parseCircuitFile(
      edited((f) => {
        (f.circuit.elements[0] as unknown as Record<string, unknown>).extra = 'x';
      }),
    );
    expect(read.elements[0]).not.toHaveProperty('extra');
  });

  it.each([
    ['text that is not JSON', 'not json'],
    ['JSON of another kind', '{"a":1}'],
    ['a list', '[]'],
    ['another format', edited((f) => void (f.format = 'x'))],
    ['an unknown component', edited((f) => void (f.circuit.elements[0].def = 'flux-capacitor'))],
    ['a rotation off the grid', edited((f) => void (f.circuit.elements[0].rot = 45 as 0))],
    ['a position that is not a number', edited((f) => void (f.circuit.elements[0].x = 'a' as unknown as number))],
    ['a property that is an object', edited((f) => void (f.circuit.elements[0].props.spec = {} as unknown as string))],
    ['a wire with one point', edited((f) => void f.circuit.wires[0].pts.pop())],
    ['two parts with the same id', edited((f) => void (f.circuit.wires[1].id = f.circuit.wires[0].id))],
    ['a missing list', edited((f) => void delete (f.circuit as Partial<typeof f.circuit>).models)],
  ])('rejects %s', (_, content) => {
    expect(() => parseCircuitFile(content)).toThrow(INVALID_FILE);
  });

  it('says so when the file comes from a newer version', () => {
    expect(() => parseCircuitFile(edited((f) => void (f.version = 99)))).toThrow('più recente');
  });

  it('turns the title into a file name', () => {
    expect(circuitFileName({ ...halfWaveRectifier(), title: 'Raddrizzatore a semionda' })).toBe('Raddrizzatore-a-semionda.json');
    expect(circuitFileName({ ...halfWaveRectifier(), title: '../../x' })).toBe('x.json');
    expect(circuitFileName({ ...halfWaveRectifier(), title: '  ' })).toBe('circuito.json');
  });
});

describe('autosave', () => {
  it('remembers the last circuit', () => {
    const storage = memoryStorage();
    expect(loadAutosave(storage)).toBeNull();
    const circuit = halfWaveRectifier();
    saveAutosave(circuit, storage);
    expect(loadAutosave(storage)).toEqual(circuit);
  });

  it('ignores damaged data', () => {
    const storage = memoryStorage();
    saveAutosave(halfWaveRectifier(), storage);
    storage.setItem('ee-sim-nextgen/circuit', '{broken');
    expect(loadAutosave(storage)).toBeNull();
  });

  it('survives a storage that refuses to work', () => {
    const storage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('full');
      },
    };
    expect(() => saveAutosave(halfWaveRectifier(), storage)).not.toThrow();
    expect(loadAutosave(storage)).toBeNull();
  });
});
