import { describe, expect, it } from 'vitest';
import { terminalKey } from '../netlist/connectivity';
import { generateNetlist } from '../netlist/generate';
import { runAc, runTransient } from '../engine/ngspice';
import { circuitFromNets, Part } from '../realtime/testCircuits';
import { parseCircuitFile, serializeCircuit } from '../storage/circuitFile';
import { loadLibrary } from '../storage/modelLibrary';
import { bodeCurve, bodeSummary } from '../ui/bode';
import { describeImport, parseModelText } from './modelImport';
import { guessOpAmpRoles, normalizeSubcircuitCard, readOpAmpRoles, subcircuitPins } from './subcircuit';

/** The structure of the classic macromodels, with round values of its own: gain about 200 V/mV, GBW about 3 MHz. */
const MACROMODEL = `* A vendor style header
*                 + - V+ V- out
.SUBCKT DEMO072   1 2 3  4  5
C1   11 12 3.5E-12
C2    6  7 15E-12
DC    5 53 DX
DE   54  5 DX
DLP  90 91 DX
DLN  92 90 DX
DP    4  3 DX
EGND 99  0 POLY(2) (3,0) (4,0) 0 .5 .5
FB    7 99 POLY(5) VB VC VE VLP VLN 0 4.7E6 -5E6 5E6 5E6 -5E6
GA    6  0 11 12 280E-6
GCM   0  6 10 99 8.8E-9
ISS   3 10 DC 195E-6
HLIM 90  0 VLIM 1K
J1   11  2 10 JX
J2   12  1 10 JX
R2    6  9 100E3
RD1   4 11 3.5E3
RD2   4 12 3.5E3
RO1   8  5 150
RO2   7 99 150
RP    3  4 15E3
RSS  10 99 1E6
VB    9  0 DC 0
VC    3 53 DC 1.5
VE   54  4 DC 1.5
VLIM  7  8 DC 0
VLP  91  0 DC 40
VLN   0 92 DC 40
.MODEL DX D(IS=800E-18 Rs=1 mfg=ACME)
.MODEL JX PJF(IS=15E-12 BETA=270E-6 VTO=-1)
.ENDS`;

const opAmp = (minus: string, plus: string, out: string, model: string, high = '15', low = '-15'): Part => ({ def: 'opamp', tag: 'U1', nets: [minus, plus, out], props: { high, low, gbw: '', model } });
const R = (tag: string, a: string, b: string, value: string): Part => ({ def: 'resistor', tag, nets: [a, b], props: { value } });
const SINE = (amplitude: string): Part => ({ def: 'vsource', tag: 'V1', nets: ['in', '0'], props: { shape: 'sin', amplitude, offset: '0', frequency: '1k', phase: '0', spec: '' } });

const importOne = (text: string) => {
  const { models, skipped } = parseModelText(text);
  expect(skipped).toEqual([]);
  expect(models).toHaveLength(1);
  return models[0];
};
const firstLines = (card: string, start: string) => card.split('\n').filter((line) => line.toLowerCase().startsWith(start));

describe('reading a subcircuit', () => {
  const model = importOne(MACROMODEL);

  it('keeps it as one op amp model, with its pins', () => {
    expect(model).toMatchObject({ name: 'DEMO072', type: 'OPAMP' });
    expect(subcircuitPins(model.card)).toEqual(['1', '2', '3', '4', '5']);
  });

  it('writes POLY as the polynomial it means', () => {
    expect(firstLines(model.card, 'begnd')).toEqual(['BEGND 99 0 V=0.5*(v(3)-v(0))+0.5*(v(4)-v(0))']);
    expect(firstLines(model.card, 'bfb')).toEqual(['BFB 7 99 I=4700000*i(VB)-5000000*i(VC)+5000000*i(VE)+5000000*i(VLP)-5000000*i(VLN)']);
    expect(model.card).not.toMatch(/poly/i);
  });

  it.each([
    ['E1 a b POLY(1) c d 2', 'BE1 a b V=2*(v(c)-v(d))'],
    ['E1 a b POLY(1) (c,d) 1 2 3', 'BE1 a b V=1+2*(v(c)-v(d))+3*(v(c)-v(d))*(v(c)-v(d))'],
    ['G1 a b POLY(2) c d e f 0 0 0 1 2 3', 'BG1 a b I=1*(v(c)-v(d))*(v(c)-v(d))+2*(v(c)-v(d))*(v(e)-v(f))+3*(v(e)-v(f))*(v(e)-v(f))'],
    ['H1 a b POLY(1) Vx 0 1k', 'BH1 a b V=1000*i(Vx)'],
    ['F1 a b POLY(2) Vx Vy 0 0 0 0 5', 'BF1 a b I=5*i(Vx)*i(Vy)'],
  ])('follows the order of the coefficients in %s', (line, expected) => {
    const { card } = importOne(`.subckt P 1 2 3 4 5\n${line}\nVx x 0 0\nVy y 0 0\n.ends`);
    expect(card.split('\n')[1]).toBe(expected);
  });

  it('writes VALUE as a B source, with the parameters between braces', () => {
    const { card } = importOne('.subckt P 1 2 3 4 5 params: G=1e5\nE1 5 0 VALUE={LIMIT(G*(V(1)-V(2)),V(4),V(3))}\n.ends');
    expect(card).toContain('BE1 5 0 V=eesim_limit({G}*(V(1)-V(2)),V(4),V(3))');
    expect(card).toContain('.func eesim_limit');
  });

  it('brings along what is defined elsewhere in the file, and does not report it apart', () => {
    const text = '.param GAIN=1e5\n.model DOUT D(IS=1f)\n.subckt HELP a e\nD1 e a DOUT\nR1 a e {GAIN}\n.ends\n.subckt MAIN 1 2 3 4 5\nX1 3 5 HELP\nB1 5 0 V=v(1)-v(2)\n.ends';
    const { models, skipped } = parseModelText(text);
    expect(skipped).toEqual([]);
    const card = models.find((m) => m.name === 'MAIN')!.card;
    expect(card.split('\n')[0]).toBe('.subckt MAIN 1 2 3 4 5');
    expect(card).toContain('.subckt HELP a e');
    expect(card).toContain('.model DOUT D(IS=1f)');
    expect(card).toContain('.param gain=100000');
  });

  it('says what cannot be used, and nothing reaches ngspice', () => {
    const skipped = (body: string) => parseModelText(`.subckt P 1 2 3 4 5\n${body}\n.ends`);
    expect(skipped('R1 1 2 1k\nX1 1 2 NOPE').skipped).toEqual(['P: manca il sottocircuito nope, che non è nel testo']);
    expect(skipped('D1 1 2 NOPE').skipped).toEqual(['P: manca il modello nope, che non è nel testo']);
    expect(skipped('E1 5 0 TABLE {v(1)} = (0,0) (1,1)').skipped).toEqual(['P: E1 usa una forma non supportata']);
    expect(skipped('E1 5 0 LAPLACE {v(1)} = {1/s}').skipped).toEqual(['P: E1 usa una forma non supportata']);
    expect(skipped('E1 5 0 VALUE={PWRS(v(1),2)}').skipped).toEqual(['P: funzione PWRS non supportata']);
    expect(skipped('A1 1 2 foo').skipped).toEqual(['P: contiene un componente non supportato (A1)']);
    expect(skipped('.control\nshell rm\n.endc').skipped).toEqual(['P: contiene .control, che non è supportato']);
    expect(skipped('.include other.lib').skipped).toEqual(['P: contiene .include, che non è supportato']);
    expect(parseModelText('.subckt P 1 2 3 4\nR1 1 2 1k\n.ends').skipped).toEqual(['P: ha 4 piedini, per ora si importano solo gli operazionali a 5']);
    expect(parseModelText('.subckt P 1 2 3 4 5\n$CDNENCSTART\n.ends').skipped).toEqual(['P: dentro non ci sono componenti leggibili: forse è cifrato']);
  });

  it('lists the parameters left out of the models inside', () => {
    expect(model.ignored).toEqual(['mfg']);
    expect(describeImport(parseModelText(MACROMODEL))).toContain('DEMO072: ignorati mfg');
  });
});

describe('a stored subcircuit', () => {
  const model = importOne(MACROMODEL);
  const circuit = circuitFromNets('t', [SINE('1'), R('R1', 'n', '0', '1k'), R('R2', 'n', 'out', '9k'), opAmp('n', 'in', 'out', 'DEMO072')]);

  it('stays the same when cleaned again', () => {
    expect(normalizeSubcircuitCard(model.card)?.card).toBe(model.card);
  });

  it('comes back from the library and from a file', () => {
    const stored = JSON.stringify([{ name: model.name, card: model.card }]);
    expect(loadLibrary({ getItem: () => stored, setItem: () => undefined })).toEqual([{ name: model.name, card: model.card }]);
    const saved = { ...circuit, models: [{ name: model.name, card: model.card }] };
    expect(parseCircuitFile(serializeCircuit(saved)).models).toEqual(saved.models);
  });

  it.each([
    ['an added command', '.subckt P 1 2 3 4 5\nR1 1 2 1k\n.ends\n.control\nshell rm\n.endc'],
    ['a command inside', '.subckt P 1 2 3 4 5\n.control\n.endc\n.ends'],
    ['a block left open', '.subckt P 1 2 3 4 5\nR1 1 2 1k'],
  ])('is refused with %s', (_, card) => {
    expect(normalizeSubcircuitCard(card)).toBeNull();
    const file = serializeCircuit({ ...circuit, models: [{ name: 'P', card }] });
    expect(() => parseCircuitFile(file)).toThrow();
    const netlist = generateNetlist({ ...circuit, models: [{ name: 'P', card }], elements: circuit.elements.map((el) => (el.def === 'opamp' ? { ...el, props: { ...el.props, model: 'P' } } : el)) }, { type: 'tran', step: '1u', stop: '1m' });
    expect(netlist.errors).toEqual(['Modello P: la card non è valida']);
  });
});

describe('the pins', () => {
  it('are told by their names when all of them speak', () => {
    expect(guessOpAmpRoles(['OUT', 'IN-', 'IN+', 'VCC', 'VEE'])).toEqual(['out', 'minus', 'plus', 'high', 'low']);
    expect(guessOpAmpRoles(['INP', 'INN', 'VDD', 'VSS', 'VOUT'])).toEqual(['plus', 'minus', 'high', 'low', 'out']);
  });

  it('otherwise follow the usual order', () => {
    expect(guessOpAmpRoles(['1', '2', '99', '50', '28'])).toEqual(['plus', 'minus', 'high', 'low', 'out']);
    expect(guessOpAmpRoles(['IN+', 'IN+', 'A', 'B', 'C'])).toEqual(['plus', 'minus', 'high', 'low', 'out']);
  });

  it('must have one of each role when chosen by hand', () => {
    const pins = ['1', '2', '3', '4', '5'];
    expect(readOpAmpRoles('out low high minus plus', pins)).toEqual(['out', 'low', 'high', 'minus', 'plus']);
    expect(readOpAmpRoles('plus plus high low out', pins)).toBeNull();
    expect(readOpAmpRoles('plus minus', pins)).toBeNull();
  });

  it('take their place on the instance, with generators for the supplies', () => {
    const { card, name } = importOne('.subckt P OUT V- V+ IN- IN+\nB1 OUT 0 V=v(IN+)-v(IN-)\n.ends');
    const circuit = { ...circuitFromNets('t', [SINE('1'), R('R1', 'out', '0', '1k'), opAmp('out', 'in', 'out', 'P', '12', '0')]), models: [{ name, card }] };
    const netlist = generateNetlist(circuit, { type: 'tran', step: '1u', stop: '1m' });
    const node = (terminal: string) => netlist.nodeOf.get(terminalKey(circuit.elements.find((el) => el.def === 'opamp')!.id, terminal));
    expect(netlist.errors).toEqual([]);
    expect(netlist.text).toContain(`XU1 ${node('out')} xlXU1 xhXU1 ${node('minus')} ${node('plus')} P`);
    expect(netlist.text).toContain('VHXU1 xhXU1 0 12');
    expect(netlist.text).toContain('VLXU1 xlXU1 0 0');
  });

  it('are an error when the model is not there', () => {
    const circuit = circuitFromNets('t', [SINE('1'), R('R1', 'out', '0', '1k'), opAmp('out', 'in', 'out', 'NOPE')]);
    expect(generateNetlist(circuit, { type: 'tran', step: '1u', stop: '1m' }).errors).toEqual(['U1: modello non definito "NOPE"']);
  });
});

describe('with ngspice', () => {
  const withModel = (parts: Part[], text = MACROMODEL) => {
    const { name, card } = importOne(text);
    return { ...circuitFromNets('t', parts), models: [{ name, card }] };
  };
  const follower = (circuit: ReturnType<typeof withModel>) => {
    const netlist = generateNetlist(circuit, { type: 'tran', step: '5u', stop: '2m', maxStep: '5u' });
    expect(netlist.errors).toEqual([]);
    const out = terminalKey(circuit.elements.find((el) => el.def === 'opamp')!.id, 'out');
    return { netlist, node: netlist.nodeOf.get(out)! };
  };
  const amplifier = (amplitude: string, high = '15', low = '-15') => [SINE(amplitude), R('R1', 'n', '0', '1k'), R('R2', 'n', 'out', '9k'), R('RL', 'out', '0', '10k'), opAmp('n', 'in', 'out', 'DEMO072', high, low)];

  it('a gain of 10 gives 10 times the input', async () => {
    const { netlist, node } = follower(withModel(amplifier('1')));
    const result = await runTransient(netlist.text);
    expect(Math.max(...result.voltages.get(node)!)).toBeCloseTo(10, 1);
  });

  it('saturates below the supply, as a real part does and the ideal one does not', async () => {
    const { netlist, node } = follower(withModel(amplifier('5')));
    const result = await runTransient(netlist.text);
    const peak = Math.max(...result.voltages.get(node)!);
    expect(peak).toBeGreaterThan(12);
    expect(peak).toBeLessThan(15);
  });

  it('the bandwidth comes from the model: gain times cutoff near its GBW', async () => {
    const circuit = withModel(amplifier('1'));
    const netlist = generateNetlist(circuit, { type: 'ac', from: '10', to: '10meg', pointsPerDecade: 50 });
    expect(netlist.errors).toEqual([]);
    const result = await runAc(netlist.text);
    const v = result.voltages.get(netlist.nodeOf.get(terminalKey(circuit.elements.find((el) => el.def === 'opamp')!.id, 'out'))!)!;
    const summary = bodeSummary(result.frequency, bodeCurve(v.re, v.im).gain);
    expect(bodeCurve(v.re, v.im).gain[0]).toBeCloseTo(20, 0);
    // gm/(2 pi C2) with the values of the model
    const gbw = 280e-6 / (2 * Math.PI * 15e-12);
    const cutoff = summary.upper!;
    expect(cutoff * 10).toBeGreaterThan(gbw * 0.6);
    expect(cutoff * 10).toBeLessThan(gbw * 1.4);
  });

  it('a behavioural model, with helpers and LIMIT at every level, gives the same gain', async () => {
    const text = '.param GAIN=1e5\n.subckt CORE a b c d e\nE1 e 0 VALUE={LIMIT(GAIN*(V(a)-V(b)),V(d),V(c))}\n.ends\n.subckt BEHAV 1 2 3 4 5\nX1 1 2 3 4 5 CORE\n.ends';
    const parts = [SINE('1'), R('R1', 'n', '0', '1k'), R('R2', 'n', 'out', '9k'), opAmp('n', 'in', 'out', 'BEHAV')];
    const { netlist, node } = follower(withModel(parts, text));
    const result = await runTransient(netlist.text);
    expect(Math.max(...result.voltages.get(node)!)).toBeCloseTo(10, 1);
  });

  it('two models using a helper of the same name each keep their own', async () => {
    const helper = (gain: number) => `.subckt H a b e\nB1 e 0 V=${gain}*(v(a)-v(b))\n.ends`;
    const one = importOne(`${helper(1)}\n.subckt ONE 1 2 3 4 5\nX1 1 2 5 H\n.ends`);
    const two = importOne(`${helper(3)}\n.subckt TWO 1 2 3 4 5\nX1 1 2 5 H\n.ends`);
    const netlist = `t\nV1 in 0 DC 1\nVP vp 0 15\nVM vm 0 -15\nXA in 0 vp vm a ONE\nXB in 0 vp vm b TWO\nRA a 0 1k\nRB b 0 1k\n${one.card}\n${two.card}\n.tran 1u 10u\n.end\n`;
    const result = await runTransient(netlist);
    expect(result.voltages.get('a')![result.time.length - 1]).toBeCloseTo(1, 3);
    expect(result.voltages.get('b')![result.time.length - 1]).toBeCloseTo(3, 3);
  });
});
