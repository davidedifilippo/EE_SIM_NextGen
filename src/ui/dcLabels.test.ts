import { describe, expect, it } from 'vitest';
import { Circuit, Rotation } from '../model/types';
import { isDcSource } from '../netlist/source';
import { compileCircuit } from '../realtime/compile';
import { buildLiveLayout } from '../realtime/liveSimulation';
import { BJT_BIAS, circuitFromNets } from '../realtime/testCircuits';
import { currentArrow, currentLabels, currentText, nodeLabels } from './dcLabels';

const layoutOf = (circuit: Circuit) => {
  const compiled = compileCircuit(circuit);
  if (!compiled.ok) throw new Error(compiled.errors.join());
  return buildLiveLayout(circuit, compiled.compiled);
};

const pt = (x: number, y: number) => ({ x, y });

describe('nodeLabels', () => {
  it('gives one label per node and none to ground', () => {
    const layout = layoutOf(circuitFromNets('t', BJT_BIAS));
    const labels = nodeLabels(layout);
    const nodes = labels.map((l) => layout.edgeNode[l.edge]);
    expect(new Set(nodes).size).toBe(nodes.length);
    expect(nodes).not.toContain(-1);
    expect(labels).toHaveLength(new Set([...layout.edgeNode].filter((n) => n >= 0)).size);
  });

  it('uses the longest edge, and a horizontal one between equal edges', () => {
    const circuit = (wires: { x: number; y: number }[][]): Circuit => ({
      title: 't',
      models: [],
      elements: [
        { id: 'v', def: 'vsource', x: 0, y: 0, rot: 0, tag: 'V1', props: { shape: 'dc', amplitude: '5' } },
        { id: 'g', def: 'ground', x: 40, y: 0, rot: 0, tag: '', props: {} },
      ],
      wires: wires.map((pts, i) => ({ id: `w${i}`, pts })),
    });
    const longest = nodeLabels(layoutOf(circuit([[pt(-40, 0), pt(-40, 200)], [pt(-40, 200), pt(60, 200)]])));
    expect(longest[0]).toMatchObject({ x: -35, y: 104, anchor: 'start' });
    const tie = nodeLabels(layoutOf(circuit([[pt(-40, 0), pt(-40, 100)], [pt(-40, 100), pt(60, 100)]])));
    expect(tie[0]).toMatchObject({ x: 10, y: 95, anchor: 'middle' });
  });
});

describe('currentLabels', () => {
  const circuit = (rot: Rotation, def = 'resistor'): Circuit => ({
    title: 't',
    models: [],
    elements: [
      { id: 'x', def, x: 100, y: 100, rot, tag: 'X1', props: def === 'resistor' ? { value: '1k' } : { model: '2N3904' } },
      { id: 'g', def: 'ground', x: 500, y: 500, rot: 0, tag: '', props: {} },
    ],
    wires: [],
  });

  it('places a current under the labels of a part, at each rotation', () => {
    const at = (rot: Rotation) => currentLabels(circuit(rot), layoutOf(circuit(rot)))[0];
    expect(at(0)).toMatchObject({ x: 100, y: 148, anchor: 'middle' });
    expect(at(90)).toMatchObject({ x: 124, y: 124, anchor: 'start' });
    expect(at(180)).toMatchObject({ x: 100, y: 148, anchor: 'middle' });
    expect(at(270)).toMatchObject({ x: 124, y: 124, anchor: 'start' });
  });

  it('gives a transistor three lines, and moves them to the free side when flipped', () => {
    const c = circuit(0, 'npn');
    const lines = currentLabels(c, layoutOf(c));
    expect(lines.map((l) => l.name)).toEqual(['Ic', 'Ib', 'Ie']);
    expect(lines.map((l) => l.y)).toEqual([124, 137, 150]);
    expect(lines[0]).toMatchObject({ x: 128, anchor: 'start' });
    const flipped = circuit(180, 'npn');
    expect(currentLabels(flipped, layoutOf(flipped))[0]).toMatchObject({ x: 72, anchor: 'end' });
  });
});

describe('current text', () => {
  it.each([
    [pt(0, 0), pt(10, 0), 1, '→'],
    [pt(0, 0), pt(10, 0), -1, '←'],
    [pt(0, 0), pt(0, 10), 1, '↓'],
    [pt(0, 0), pt(0, 10), -1, '↑'],
    [pt(10, 0), pt(0, 0), 1, '←'],
    [pt(0, 10), pt(0, 0), 1, '↑'],
    [pt(20, -40), pt(0, 0), 1, '↓'],
  ])('points along the path from %o to %o', (a, b, current, arrow) => {
    expect(currentArrow({ a, b }, current)).toBe(arrow);
  });

  it('writes the size without its sign, since the arrow has it', () => {
    expect(currentText('', { a: pt(0, 0), b: pt(0, 10) }, -4.44e-3)).toBe('↑ 4,44 mA');
    expect(currentText('Ic', { a: pt(0, 0), b: pt(0, 10) }, 2e-3)).toBe('Ic ↓ 2 mA');
  });

  it('leaves out what is too small to mean anything', () => {
    expect(currentText('', { a: pt(0, 0), b: pt(0, 10) }, 5e-10)).toBe('');
    expect(currentText('', { a: pt(0, 0), b: pt(0, 10) }, 1e-9)).not.toBe('');
  });
});

describe('isDcSource', () => {
  it.each([
    [{ shape: 'dc', amplitude: '5' }, true],
    [{ shape: 'sin', amplitude: '5' }, false],
    [{ shape: 'square', amplitude: '5' }, false],
    [{ shape: 'custom', spec: 'DC 5' }, true],
    [{ shape: 'custom', spec: '12' }, true],
    [{ spec: 'DC 5' }, true],
    [{ shape: 'custom', spec: 'SIN(0 5 50)' }, false],
    [{ shape: 'custom', spec: 'PULSE(0 5)' }, false],
    [{ shape: 'custom', spec: '' }, false],
  ])('%o: %s', (props, expected) => {
    expect(isDcSource(props)).toBe(expected);
  });
});
