import { describe, expect, it } from 'vitest';
import { circuitFromNets } from '../realtime/testCircuits';
import { halfWaveRectifier } from '../samples/halfWaveRectifier';
import { elementProbes, liveTraces, nextSlot, nodeWire, ScopeTrace, traceLabel, unitOf, wireProbe } from './scopeTraces';

const circuit = halfWaveRectifier();

describe('probe choices', () => {
  it('offers voltage and current on a two-terminal part', () => {
    const r1 = circuit.elements.find((e) => e.id === 'r1')!;
    expect(elementProbes(r1).map((c) => c.label)).toEqual(['Tensione', 'Corrente']);
  });

  it('offers the four quantities of a transistor', () => {
    const q = circuitFromNets('t', [{ def: 'npn', tag: 'Q1', nets: ['c', 'b', '0'], props: { model: '2N3904' } }]).elements[0];
    expect(elementProbes(q).map((c) => c.label)).toEqual(['Vce', 'Vbe', 'Ic', 'Ib']);
    expect(elementProbes(q).map((c) => unitOf(c.probe))).toEqual(['V', 'V', 'A', 'A']);
  });

  it('offers nothing on ground', () => {
    expect(elementProbes(circuit.elements.find((e) => e.def === 'ground')!)).toEqual([]);
  });
});

describe('wires of one node', () => {
  it('lead to one probe', () => {
    const c = {
      ...circuit,
      wires: [...circuit.wires, { id: 'w4', pts: [{ x: 0, y: -40 }, { x: 0, y: -80 }] }],
    };
    expect(nodeWire('w4', c)).toBe('w1');
    expect(nodeWire('w1', c)).toBe('w1');
    expect(nodeWire('w2', c)).toBe('w2');
  });
});

describe('labels', () => {
  it('name parts and nodes in the terms of the drawing', () => {
    expect(traceLabel({ id: 'a', kind: 'voltage', elementId: 'r1' }, circuit)).toBe('V(R1)');
    expect(traceLabel({ id: 'a', kind: 'current', elementId: 'r1' }, circuit)).toBe('I(R1)');
    expect(traceLabel(wireProbe('w1').probe, circuit)).toBe('V(V1.pos)');
    expect(traceLabel(wireProbe('w3').probe, circuit)).toBe('V(V1.neg)');
  });

  it('calls a node without terminals just a node', () => {
    const open = { ...circuit, elements: [], wires: [{ id: 'x', pts: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }] };
    expect(traceLabel(wireProbe('x').probe, open)).toBe('V(nodo)');
  });

  it('uses the transistor names', () => {
    const c = circuitFromNets('t', [{ def: 'npn', tag: 'Q1', nets: ['c', 'b', '0'], props: { model: '2N3904' } }]);
    expect(traceLabel({ id: 'a', kind: 'voltage', elementId: 'q1' }, c)).toBe('Vce(Q1)');
    expect(traceLabel({ id: 'a', kind: 'current', elementId: 'q1' }, c)).toBe('Ic(Q1)');
  });
});

describe('traces over time', () => {
  const traces: ScopeTrace[] = [
    { id: 'a', kind: 'voltage', elementId: 'r1', slot: 1 },
    { id: 'b', kind: 'node', wireId: 'w1', slot: 2 },
  ];

  it('keeps the color of a trace when another goes away', () => {
    expect(nextSlot([traces[1]])).toBe(1);
    expect(nextSlot(traces)).toBe(3);
  });

  it('drops the traces of what is deleted, and keeps the same array otherwise', () => {
    expect(liveTraces(traces, circuit)).toBe(traces);
    expect(liveTraces(traces, { ...circuit, wires: [] })).toEqual([traces[0]]);
    expect(liveTraces(traces, { ...circuit, elements: [] })).toEqual([traces[1]]);
  });
});
