import { describe, expect, it } from 'vitest';
import { searchParts } from '../ui/ComponentLibrary';
import { generateNetlist } from '../netlist/generate';
import { isDcSource } from '../netlist/source';
import { compileCircuit } from '../realtime/compile';
import { RealtimeEngine } from '../realtime/engine';
import { circuitFromNets } from '../realtime/testCircuits';
import { createElement, DEVICES, getDevice } from './devices';

const parts = DEVICES.filter((def) => !def.isHidden);

describe('the sources of continuous voltage', () => {
  const dc = { shape: 'dc', amplitude: '9' };

  it.each(['dcsupply', 'battery'] as const)('%s is a generator to both engines', async (def) => {
    const circuit = circuitFromNets('t', [{ def, tag: 'V1', nets: ['a', '0'], props: dc }, { def: 'resistor', tag: 'R1', nets: ['a', '0'], props: { value: '1k' } }]);
    const netlist = generateNetlist(circuit, { type: 'dc', source: 'v1', from: '0', to: '10', step: '5' });
    expect(netlist.errors).toEqual([]);
    expect(generateNetlist(circuit, { type: 'tran', step: '1u', stop: '10u' }).text).toMatch(/^V1 \S+ 0 DC 9$/m);
    const compiled = compileCircuit(circuit);
    if (!compiled.ok) throw new Error(compiled.errors.join());
    const engine = new RealtimeEngine(compiled.compiled);
    engine.initialize();
    expect(engine.terminalCurrents(compiled.compiled.elementIds.indexOf('v1'))[0]).toBeCloseTo(-9e-3, 6);
  });

  it('are made to give continuous voltage from the start', () => {
    expect(createElement(getDevice('battery')!, { x: 0, y: 0 }, 0, { title: '', elements: [], wires: [], models: [] }, 'b').props).toEqual({ shape: 'dc', amplitude: '9', rint: '1' });
    expect(isDcSource(createElement(getDevice('dcsupply')!, { x: 0, y: 0 }, 0, { title: '', elements: [], wires: [], models: [] }, 'd').props)).toBe(true);
    expect(createElement(getDevice('vsource')!, { x: 0, y: 0 }, 0, { title: '', elements: [], wires: [], models: [] }, 'v').props.shape).toBe('sin');
  });
});

describe('the sections of the library', () => {
  it('have a part for each regulator, each with its voltage', () => {
    const regulators = parts.filter((def) => def.category === 'Regolatori');
    expect(regulators.map((def) => def.name)).toEqual(['7805', '7806', '7808', '7809', '7812', '7815', '7824', '7905', '7912', '7915', 'LM317', 'LM337']);
    const voltage = (name: string) => {
      const spice = regulators.find((def) => def.name === name)!.spice;
      return spice.kind === 'regulator' ? spice.polarity * spice.vNominal : NaN;
    };
    expect(voltage('7805')).toBe(5);
    expect(voltage('7824')).toBe(24);
    expect(voltage('7912')).toBe(-12);
    expect(voltage('LM317')).toBe(1.25);
  });

  it('put ground among the sources, and leave no part out of the list', () => {
    expect(parts.filter((def) => def.category === 'Sorgenti').map((def) => def.name)).toEqual(['Alimentazione continua', 'Batteria', 'Generatore', 'Generatore di corrente', 'Massa']);
    const sections = ['Sorgenti', 'Passivi', 'Semiconduttori', 'Operazionali', 'Regolatori', 'Sensori', 'Motori', 'Logica', 'Strumenti', 'Altri'];
    expect(parts.filter((def) => !sections.includes(def.category))).toEqual([]);
  });

  it('find ground by its other names', () => {
    expect(searchParts(parts, 'gnd').map((def) => def.name)).toEqual(['Massa']);
  });

  it('find a part by name, section or tag', () => {
    expect(searchParts(parts, 'res').map((def) => def.name)).toEqual(['Resistore', 'Trasformatore a presa centrale', 'Ingresso logico', 'Potenziometro']);
    expect(searchParts(parts, 'relè').map((def) => def.name)).toEqual(['Relè SPST 5 V', 'Relè SPST 12 V']);
    expect(searchParts(parts, 'porta').map((def) => def.name)).toEqual(['AND', 'OR', 'NOT', 'NAND', 'NOR', 'XOR']);
    expect(searchParts(parts, '781').map((def) => def.name)).toEqual(['7812', '7815']);
    expect(searchParts(parts, 'mm').map((def) => def.name)).toEqual(['Multimetro', 'Multimetro compatto']);
    expect(searchParts(parts, 'regolatori')).toHaveLength(12);
    expect(searchParts(parts, 'zzz')).toEqual([]);
    expect(searchParts(parts, '  ')).toHaveLength(parts.length);
  });

  it('leave out the blocks of each size, which come from the model', () => {
    expect(parts.filter((def) => def.spice.kind === 'block').map((def) => def.name)).toEqual(['Sottocircuito']);
    expect(getDevice('block5')?.isHidden).toBe(true);
  });
});
