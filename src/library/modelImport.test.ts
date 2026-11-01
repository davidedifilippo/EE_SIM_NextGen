import { describe, expect, it } from 'vitest';
import { runTransient } from '../engine/ngspice';
import { normalizeModelCard, parseModelText } from './modelImport';
import { modelType } from './models';

const VENDOR_STYLE = `
* A library file in the usual style
* Comment with .model FAKE NPN(IS=1) inside
.MODEL BC547X NPN (IS=1.8E-14 ISE=5.0E-14 NF=.9955 NE=1.46 BF=400 ; base gain
+ BR=35.5 IKF=.14 IKR=.03 ISC=1.72E-13
+ NC=1.27 NR=1.005 RB=.56 RE=.6 RC=.25 VAF=80 VAR=12.5,
+ CJE=13p TF=.64n CJC=4p TR=50.72n
+ Vceo=45 Icrating=100m mfg=Example)

.model DX5V6 D(Is=1n Rs=2 N=1.2 Bv=5.6 Ibv=20m Cjo=100p Iave=500m Vpk=5.6 mfg=Example type=zener)
.model QP pnp is=1f bf=120
.MODEL M1 NMOS (VTO=2)
.SUBCKT OPA 1 2 3
.model INSIDE NPN(IS=1f)
Q1 1 2 3 INSIDE
R1 1 2 1k
.ENDS OPA
`;

describe('parseModelText', () => {
  const { models, skipped } = parseModelText(VENDOR_STYLE);
  const byName = new Map(models.map((m) => [m.name, m]));

  it('finds the models, not what is in comments or subcircuits', () => {
    expect(models.map((m) => m.name)).toEqual(['BC547X', 'DX5V6', 'QP']);
  });

  it('joins continuation lines and drops comments', () => {
    const { card } = byName.get('BC547X')!;
    expect(card).toContain('IS=1.8E-14');
    expect(card).toContain('BR=35.5');
    expect(card).toContain('TR=50.72n');
    expect(card).not.toContain('base gain');
    expect(card).not.toContain('\n');
  });

  it('keeps only what ngspice accepts, and says what it left out', () => {
    const bjt = byName.get('BC547X')!;
    expect(bjt.ignored).toEqual(['Vceo', 'Icrating', 'mfg']);
    expect(bjt.card).not.toMatch(/vceo|icrating|mfg/i);
    expect(byName.get('DX5V6')!.ignored).toEqual(['Iave', 'Vpk', 'mfg', 'type']);
  });

  it('reads the type, whatever its case and even without parentheses', () => {
    expect(byName.get('QP')).toMatchObject({ type: 'PNP', card: '.model QP PNP(IS=1f BF=120)' });
    expect(modelType(byName.get('QP')!.card)).toBe('PNP');
  });

  it('explains what it cannot use', () => {
    expect(skipped).toEqual(['M1: modello NMOS non ancora supportato', 'OPA: i sottocircuiti non sono ancora supportati']);
  });

  it('finds nothing in text without models', () => {
    expect(parseModelText('just some text\nand more')).toEqual({ models: [], skipped: [] });
  });

  it('takes the last definition of a repeated name', () => {
    const read = parseModelText('.model A D(IS=1n)\n.model A D(IS=2n)');
    expect(read.models.map((m) => m.card)).toEqual(['.model A D(IS=2n)']);
  });
});

// The shape of the models Diotec publishes, with values of a made up part
const DATASHEET_WRAPPER = `
* Example part
.subckt PARTX  C  B  E  params: Vceo=45 Vcbo=50 Vebo=5 Ic=100m hfe=450 Ices=.2n Vbe=580m ft=300Meg Ccbo=3.5p Cebo=9p Rc=1 Rb=.1 Re=.1 Eg=1.11 Xti=3

* Vceo  Collector Emitter voltage, Base open

Q  C B E  Transistor

.model Transistor NPN(Is={Ices/2} Bf={hfe} Bvcbo={Vcbo} Bvbe={-Vebo} Vceo={Vceo} Vje={Vbe} Tf={1/(2*pi*ft)} Eg={Eg} Xti={Xti} Icrating={Ic} Cjc={Ccbo*2} Cje={Cebo*2} Rc={Rc} Rb={Rb} Re={Re} mfg=Example type=npn)

.ends
`;

describe('a subcircuit that only wraps one part', () => {
  const { models, skipped } = parseModelText(DATASHEET_WRAPPER);

  it('becomes a model with the name of the subcircuit', () => {
    expect(skipped).toEqual([]);
    expect(models.map((m) => [m.name, m.type])).toEqual([['PARTX', 'NPN']]);
  });

  it('computes the values from the datasheet parameters', () => {
    const { card } = models[0];
    expect(card).toMatch(/^\.model PARTX NPN\(/);
    expect(card).toContain('BF=450');
    expect(card).toMatch(/IS=1(\.0+\d*)?e-10/);
    expect(card).toContain('VJE=0.58');
    expect(card).toContain('RC=1');
    const tf = /TF=(\S+)/.exec(card)![1];
    expect(Number(tf)).toBeCloseTo(1 / (2 * Math.PI * 300e6), 15);
  });

  it('leaves out what ngspice would not accept', () => {
    expect(models[0].ignored).toEqual(['Bvcbo', 'Bvbe', 'Vceo', 'Icrating', 'mfg', 'type']);
  });

  it('runs in ngspice', async () => {
    const netlist = `t\nV1 c 0 DC 5\nRB c b 430k\nQ1 c b 0 PARTX\n${models[0].card}\n.tran 10u 100u\n.end\n`;
    const result = await runTransient(netlist);
    expect(result.voltages.get('b')![result.time.length - 1]).toBeGreaterThan(0.2);
  });

  it.each([
    ['another device too', '.subckt X C B E\nQ C B E M\nR1 C B 1k\n.model M NPN(IS=1f)\n.ends'],
    ['pins in another order', '.subckt X B C E\nQ C B E M\n.model M NPN(IS=1f)\n.ends'],
    ['a fourth pin on the transistor', '.subckt X C B E S\nQ C B E S M\n.model M NPN(IS=1f)\n.ends'],
    ['a model defined elsewhere', '.subckt X C B E\nQ C B E M\n.ends'],
    ['a diode with a transistor model', '.subckt X A K\nD A K M\n.model M NPN(IS=1f)\n.ends'],
    ['a device option', '.subckt X C B E\nQ C B E M area=2\n.model M NPN(IS=1f)\n.ends'],
  ])('stays a subcircuit with %s', (_, text) => {
    const read = parseModelText(text);
    expect(read.models).toEqual([]);
    expect(read.skipped).toEqual(['X: i sottocircuiti non sono ancora supportati']);
  });

  it('also unwraps a diode, with parameters from a .param line', () => {
    const read = parseModelText('.subckt Z A K\n.param vz=4.7\nD A K M\n.model M D(BV={vz})\n.ends');
    expect(read.models[0]).toMatchObject({ name: 'Z', card: '.model Z D(BV=4.7)' });
  });
});

describe('expressions', () => {
  it('uses .param lines for models outside subcircuits', () => {
    expect(parseModelText('.param gain=200\n.model A NPN(BF={gain*2})').models[0].card).toBe('.model A NPN(BF=400)');
  });

  it('never imports an empty model: what cannot be computed is reported', () => {
    const read = parseModelText('.model Transistor NPN(Is={Ices/2} Bf={hfe} Rc=1)');
    expect(read.models).toEqual([]);
    expect(read.skipped).toEqual(['Transistor: valori non calcolabili per Is, Bf']);
  });
});

describe('normalizeModelCard', () => {
  it.each(['.model A', '.model bad\nname D(IS=1)', 'R1 a b 1k', '.model a;b D(IS=1)', '.model A NMOS(VTO=1)'])('refuses %j', (card) => {
    expect(normalizeModelCard(card)).toBeNull();
  });

  it('leaves out values that are not numbers', () => {
    expect(normalizeModelCard('.model A D(IS=abc RS=1)')).toMatchObject({ card: '.model A D(RS=1)', ignored: ['IS'] });
  });

  it('cannot carry a second line', () => {
    expect(normalizeModelCard('.model A D(IS=1n\n.control\nRS=1)')!.card).not.toContain('\n');
  });
});

describe('with ngspice', () => {
  it('runs what comes out of a vendor style file, which would stop it as written', async () => {
    const { models } = parseModelText(VENDOR_STYLE);
    const cards = models.map((m) => m.card).join('\n');
    const netlist = `t\nV1 c 0 DC 12\nRB c b 430k\nQ1 c b 0 BC547X\nR1 c z 1k\nD1 0 z DX5V6\nRE c e 1k\nQ2 0 b e QP\n${cards}\n.tran 10u 100u\n.end\n`;
    const result = await runTransient(netlist);
    const last = (node: string) => result.voltages.get(node)![result.time.length - 1];
    expect(last('b')).toBeGreaterThan(0.5);
    expect(last('z')).toBeGreaterThan(5);
    expect(last('z')).toBeLessThan(6);
  });
});
