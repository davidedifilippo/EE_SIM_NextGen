import { describe, expect, it } from 'vitest';
import { circuitFromNets } from '../realtime/testCircuits';
import { Circuit } from '../model/types';
import { halfWaveRectifier } from '../samples/halfWaveRectifier';
import { describeNodes, generateNetlist, sweepCount } from './generate';

const TRAN = { type: 'tran', step: '1u', stop: '1m' } as const;

const resistorPair = (): Circuit => ({
  title: 'test',
  elements: [
    { id: 'r1', def: 'resistor', x: 40, y: 0, rot: 0, tag: 'R1', props: { value: '1k' } },
    { id: 'r2', def: 'resistor', x: 120, y: 0, rot: 0, tag: 'R2', props: { value: '2k' } },
    { id: 'gnd', def: 'ground', x: 0, y: 0, rot: 0, tag: 'GND', props: {} },
    { id: 'gnd2', def: 'ground', x: 160, y: 0, rot: 0, tag: 'GND2', props: {} },
  ],
  wires: [],
  models: [],
});

describe('generateNetlist', () => {
  it('writes the rectifier netlist', () => {
    const { text, errors } = generateNetlist(halfWaveRectifier(), { ...TRAN, maxStep: '10u' });
    expect(errors).toEqual([]);
    expect(text.split('\n')).toEqual([
      'Raddrizzatore a semionda',
      'V1 n1 0 SIN(0 10 50)',
      'D1 n1 n2 D1N4148',
      'R1 n2 0 1k',
      '.model D1N4148 D(IS=2.52n RS=0.568 N=1.752 BV=100 IBV=100u CJO=4p M=0.333 VJ=0.75 TT=11.54n)',
      '.tran 1u 1m 0 10u',
      '.end',
      '',
    ]);
  });

  it('follows element rotation when assigning terminals', () => {
    const { text } = generateNetlist(halfWaveRectifier({ reversed: true }), TRAN);
    expect(text).toContain('D1 n2 n1 D1N4148');
  });

  it('joins coincident terminals without a wire', () => {
    const { text, errors } = generateNetlist(resistorPair(), TRAN);
    expect(errors).toEqual([]);
    expect(text).toContain('R1 0 n1 1k');
    expect(text).toContain('R2 n1 0 2k');
  });

  it('joins a wire ending on another wire, but not wires that only cross', () => {
    const base = (extra: Circuit['wires']): Circuit => ({
      title: 't',
      elements: [
        { id: 'r1', def: 'resistor', x: 40, y: 0, rot: 0, tag: 'R1', props: { value: '1' } },
        { id: 'r2', def: 'resistor', x: 40, y: 100, rot: 0, tag: 'R2', props: { value: '1' } },
        { id: 'g1', def: 'ground', x: 0, y: 0, rot: 0, tag: 'G1', props: {} },
        { id: 'g2', def: 'ground', x: 0, y: 100, rot: 0, tag: 'G2', props: {} },
      ],
      wires: [{ id: 'a', pts: [{ x: 80, y: 0 }, { x: 200, y: 0 }] }, ...extra],
      models: [],
    });

    const tee = generateNetlist(base([{ id: 'b', pts: [{ x: 80, y: 100 }, { x: 140, y: 100 }, { x: 140, y: 0 }] }]), TRAN);
    expect(tee.errors).toEqual([]);
    expect(tee.nodeOf.get('r1:b')).toBe(tee.nodeOf.get('r2:b'));

    const cross = generateNetlist(base([{ id: 'b', pts: [{ x: 80, y: 100 }, { x: 140, y: 100 }, { x: 140, y: -50 }] }]), TRAN);
    expect(cross.errors).toEqual([]);
    expect(cross.nodeOf.get('r1:b')).not.toBe(cross.nodeOf.get('r2:b'));
  });

  it('reports a missing ground', () => {
    const c = resistorPair();
    c.elements = c.elements.filter((e) => e.def !== 'ground');
    expect(generateNetlist(c, TRAN).errors).toContain('Il circuito non ha una massa');
  });

  it('reports an unconnected terminal', () => {
    const c = resistorPair();
    c.elements = c.elements.filter((e) => e.id !== 'gnd2');
    expect(generateNetlist(c, TRAN).errors).toContain('Terminale non collegato: R2.b');
  });

  it('reports an undefined diode model', () => {
    const c = halfWaveRectifier();
    c.elements.find((e) => e.tag === 'D1')!.props.model = 'BOH';
    const { errors, text } = generateNetlist(c, TRAN);
    expect(errors).toContain('D1: modello non definito "BOH"');
    expect(text).toBe('');
  });

  it('finds library models, and a model of the circuit takes precedence', () => {
    const c = halfWaveRectifier();
    c.models = [];
    expect(generateNetlist(c, TRAN).text).toContain('.model D1N4148 D(IS=2.52n');
    c.models = [{ name: 'D1N4148', card: '.model D1N4148 D(IS=1n)' }];
    expect(generateNetlist(c, TRAN).text).toContain('.model D1N4148 D(IS=1n)');
  });

  it('writes a transistor with collector, base and emitter, and its model once', () => {
    const c = circuitFromNets('t', [
      { def: 'npn', tag: 'Q1', nets: ['c', 'b', '0'], props: { model: '2N3904' } },
      { def: 'npn', tag: 'Q2', nets: ['c', 'b', '0'], props: { model: '2N3904' } },
    ]);
    const { text, nodeOf } = generateNetlist(c, TRAN);
    const [nc, nb] = [nodeOf.get('q1:collector'), nodeOf.get('q1:base')];
    expect(text).toContain(`Q1 ${nc} ${nb} 0 2N3904`);
    expect(text.match(/\.model 2N3904/g)).toHaveLength(1);
  });

  it('ties the bulk of a MOSFET to the source, and writes three nodes for a VDMOS', () => {
    const level1 = circuitFromNets('t', [{ def: 'nmos', tag: 'M1', nets: ['d', 'g', 's'], props: { model: 'MN1' } }]);
    const read = generateNetlist(level1, TRAN);
    const [nd, ng, ns] = ['drain', 'gate', 'source'].map((t) => read.nodeOf.get(`m1:${t}`));
    expect(read.text).toContain(`M1 ${nd} ${ng} ${ns} ${ns} MN1`);
    const vdmos = circuitFromNets('t', [{ def: 'pmos', tag: 'M1', nets: ['d', 'g', 's'], props: { model: 'VP' } }]);
    vdmos.models.push({ name: 'VP', card: '.model VP VDMOS(PCHAN VTO=-2)' });
    const other = generateNetlist(vdmos, TRAN);
    const [d2, g2, s2] = ['drain', 'gate', 'source'].map((t) => other.nodeOf.get(`m1:${t}`));
    expect(other.text).toContain(`M1 ${d2} ${g2} ${s2} VP`);
  });

  it('writes an op amp as a source limited to its rails', () => {
    const c = circuitFromNets('t', [{ def: 'opamp', tag: 'U1', nets: ['n', 'p', 'o'], props: { high: '12', low: '-5' } }]);
    const read = generateNetlist(c, TRAN);
    const [o, p, n] = ['out', 'plus', 'minus'].map((t) => read.nodeOf.get(`u1:${t}`));
    expect(read.text).toContain(`BU1 xBU1 0 V = max(-5, min(12, 1000000*(v(${p})-v(${n}))))`);
    expect(read.text).toContain(`ROBU1 xBU1 ${o} 0.1`);
  });

  it('pushes an op amp only when asked, and only during the first step', () => {
    const c = circuitFromNets('t', [{ def: 'opamp', tag: 'U1', nets: ['n', 'p', 'o'], props: { high: '15', low: '-15' } }]);
    expect(generateNetlist(c, { type: 'tran', step: '1', stop: '10' }, new Set(['u1'])).text).toContain('+30*u(time-1e-12)*u(1-time)');
    expect(generateNetlist(c, { type: 'tran', step: '1', stop: '10' }).text).not.toContain('u(time)');
  });

  describe('AC', () => {
    const AC = { type: 'ac', from: '10', to: '100k', pointsPerDecade: 50 } as const;

    it('sweeps by decades, with the signal at 1 V', () => {
      const { text, errors } = generateNetlist(halfWaveRectifier(), AC);
      expect(errors).toEqual([]);
      expect(text).toContain('.ac dec 50 10 100k');
      expect(text).toContain('DC 0 AC 1');
      expect(text).not.toContain('.tran');
    });

    it('needs a signal to apply', () => {
      const c = halfWaveRectifier();
      c.elements[0].props = { shape: 'dc', amplitude: '5' };
      expect(generateNetlist(c, AC).errors[0]).toContain('serve un generatore di segnale');
    });

    it.each([
      [{ from: 'abc' }, 'Da: valore non valido "abc"'],
      [{ to: '1\n.control' }, 'A: valore non valido "1\n.control"'],
      [{ from: '0' }, 'La frequenza "A" deve essere maggiore di "Da", ed entrambe positive'],
      [{ from: '100', to: '10' }, 'La frequenza "A" deve essere maggiore di "Da", ed entrambe positive'],
    ])('checks the range %o', (change, message) => {
      expect(generateNetlist(halfWaveRectifier(), { ...AC, ...change }).errors).toContain(message);
    });
  });

  describe('DC sweep', () => {
    const DC = { type: 'dc', source: 'v1', from: '0', to: '10', step: '0.1' } as const;

    it('sweeps the generator by its name in the netlist, at its DC level', () => {
      const { text, errors } = generateNetlist(halfWaveRectifier(), DC);
      expect(errors).toEqual([]);
      expect(text).toContain('.dc V1 0 10 0.1');
      expect(text).toContain('V1 n1 0 DC 0');
      expect(text).not.toContain('SIN(');
    });

    it('adds a family around it', () => {
      const c = circuitFromNets('t', [
        { def: 'vsource', tag: 'A', nets: ['x', '0'], props: { spec: 'DC 1' } },
        { def: 'vsource', tag: 'V2', nets: ['y', '0'], props: { spec: 'DC 1' } },
        { def: 'resistor', tag: 'R1', nets: ['x', 'y'], props: { value: '1k' } },
      ]);
      const { text } = generateNetlist(c, { type: 'dc', source: 'a', from: '0', to: '5', step: '1', familySource: 'v2', familyFrom: '0', familyTo: '2', familyStep: '1' });
      expect(text).toContain('.dc VA 0 5 1 V2 0 2 1');
    });

    it.each([
      [{ source: 'x' }, 'Scegli il generatore da far variare'],
      [{ source: 'r1' }, 'Scegli il generatore da far variare'],
      [{ to: '-1' }, 'Il DC sweep vuole "A" non minore di "Da" e un passo positivo'],
      [{ step: '0' }, 'Il DC sweep vuole "A" non minore di "Da" e un passo positivo'],
      [{ step: '0.001' }, 'Il DC sweep ha 10001 punti: il massimo è 5000, aumenta il passo'],
      [{ familySource: 'v1', familyFrom: '0', familyTo: '1', familyStep: '1' }, 'La famiglia vuole un secondo generatore, diverso dal primo'],
      [{ step: 'abc' }, 'Passo: valore non valido "abc"'],
    ])('checks %o', (change, message) => {
      expect(generateNetlist(halfWaveRectifier(), { ...DC, ...change }).errors).toContain(message);
    });

    it('limits the number of curves', () => {
      const c = circuitFromNets('t', [
        { def: 'vsource', tag: 'V1', nets: ['x', '0'], props: { spec: 'DC 1' } },
        { def: 'vsource', tag: 'V2', nets: ['y', '0'], props: { spec: 'DC 1' } },
        { def: 'resistor', tag: 'R1', nets: ['x', 'y'], props: { value: '1k' } },
      ]);
      expect(generateNetlist(c, { ...DC, familySource: 'v2', familyFrom: '0', familyTo: '20', familyStep: '1' }).errors).toContain('La famiglia ha 21 curve: il massimo è 12');
    });

    it('counts the values of a sweep', () => {
      expect(sweepCount('0', '10', '0.1')).toBe(101);
      expect(sweepCount('1', '1', '1')).toBe(1);
      expect(sweepCount('1', '0', '1')).toBeNull();
      expect(sweepCount('0', '1', '-1')).toBeNull();
    });
  });

  it('refuses rails that make no sense', () => {
    const c = circuitFromNets('t', [{ def: 'opamp', tag: 'U1', nets: ['n', 'p', 'o'], props: { high: '1\n.control', low: '-5' } }]);
    expect(generateNetlist(c, TRAN).errors).toContain('U1: alimentazioni non valide');
  });

  it('refuses a model of the wrong kind', () => {
    const c = circuitFromNets('t', [{ def: 'pnp', tag: 'Q1', nets: ['c', 'b', '0'], props: { model: '2N3904' } }]);
    expect(generateNetlist(c, TRAN).errors).toContain('Q1: il modello "2N3904" non è di tipo PNP');
  });

  it('reports duplicate names, ignoring case', () => {
    const c = resistorPair();
    c.elements[1].tag = 'r1';
    expect(generateNetlist(c, TRAN).errors).toContain('Nome duplicato: r1');
  });

  it.each(['abc', '', '1k\n.include /etc/passwd'])('rejects the invalid value %j', (value) => {
    const c = resistorPair();
    c.elements[0].props.value = value;
    expect(generateNetlist(c, TRAN).errors[0]).toContain('valore non valido');
  });

  it('accepts SPICE suffixes', () => {
    const c = resistorPair();
    c.elements[0].props.value = '4.7meg';
    c.elements[1].props.value = '1e3';
    expect(generateNetlist(c, TRAN).errors).toEqual([]);
  });

  it('rejects multi-line source specs', () => {
    const c = halfWaveRectifier();
    c.elements[0].props = { shape: 'custom', spec: 'DC 1\n.control' };
    expect(generateNetlist(c, TRAN).errors[0]).toContain('sorgente non valida');
  });

  it('rejects invalid analysis values', () => {
    const { errors } = generateNetlist(resistorPair(), { type: 'tran', step: '1u\n.control', stop: 'abc' });
    expect(errors).toEqual(['Durata: valore non valido "abc"', 'Passo: valore non valido "1u\n.control"']);
  });

  it('describes nodes by the terminals they join', () => {
    const c = halfWaveRectifier();
    const labels = describeNodes(c, generateNetlist(c, TRAN).nodeOf);
    expect(labels.get('n1')).toBe('V1.pos, D1.anode');
    expect(labels.get('n2')).toBe('D1.cathode, R1.a');
    expect(labels.has('0')).toBe(false);
  });

  it('prefixes tags that lack the SPICE letter', () => {
    const c = resistorPair();
    c.elements[0].tag = 'LOAD';
    expect(generateNetlist(c, TRAN).text).toContain('RLOAD 0 n1 1k');
  });
});
