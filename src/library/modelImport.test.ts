import { describe, expect, it } from 'vitest';
import { runTransient } from '../engine/ngspice';
import { describeImport, normalizeModelCard, parseModelText } from './modelImport';
import { isVdmos, modelType } from './models';

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
.MODEL J1 NJF (VTO=-2)
.SUBCKT OPA 1 2 3
.model INSIDE NPN(IS=1f)
Q1 1 2 3 INSIDE
R1 1 2 1k
.ENDS OPA
`;

describe('parseModelText', () => {
  const { models, skipped } = parseModelText(VENDOR_STYLE);
  const byName = new Map(models.map((m) => [m.name, m]));

  it('finds the models, and the subcircuits as such, not what is in comments', () => {
    expect(models.map((m) => m.name)).toEqual(['BC547X', 'DX5V6', 'QP', 'OPA']);
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
    expect(skipped).toEqual(['J1: modello NJF non ancora supportato']);
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
    ['a device option', '.subckt X C B E\nQ C B E M area=2\n.model M NPN(IS=1f)\n.ends'],
  ])('stays a subcircuit with %s', (_, text) => {
    const read = parseModelText(text);
    expect(read.skipped).toEqual([]);
    expect(read.models[0]).toMatchObject({ name: 'X', type: 'SUBCKT' });
  });

  it.each([
    ['a model defined elsewhere', '.subckt X C B E\nQ C B E M\n.ends', 'X: manca il modello m, che non è nel testo'],
    ['a diode with a transistor model', '.subckt X A K\nD A K M\n.model M NPN(IS=1f)\n.ends', 'X: D usa un modello del tipo sbagliato'],
  ])('is refused with %s', (_, text, reason) => {
    const read = parseModelText(text);
    expect(read.models).toEqual([]);
    expect(read.skipped).toEqual([reason]);
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

describe('AKO models', () => {
  it('takes the parameters of the base and replaces some', () => {
    const { models, skipped } = parseModelText('.model A NPN(IS=1f BF=100 VAF=50)\n.model B ako:A NPN(BF=300 mfg=X)');
    expect(skipped).toEqual([]);
    expect(models[1]).toMatchObject({ name: 'B', type: 'NPN', card: '.model B NPN(IS=1f BF=300 VAF=50)', ignored: ['mfg'] });
  });

  it('accepts a base defined later, another case, and no replacements', () => {
    const { models } = parseModelText('.MODEL B AKO:a\n.model A PNP(IS=1f)');
    expect(models.map((m) => m.card)).toEqual(['.model A PNP(IS=1f)', '.model B PNP(IS=1f)']);
  });

  it('can chain', () => {
    const { models } = parseModelText('.model A D(IS=1n RS=1)\n.model B ako:A(RS=2)\n.model C ako:B(N=2)');
    expect(models[2].card).toBe('.model C D(IS=1n RS=2 N=2)');
  });

  it('says when the base is missing', () => {
    expect(parseModelText('.model B ako:ZZZ NPN(BF=1)')).toEqual({ models: [], skipped: ['B: il modello di partenza ZZZ non è nel testo'] });
  });

  it('runs in ngspice', async () => {
    const { models } = parseModelText('.model FZT NPN(IS=1f BF=100 Vceo=45)\n.model ZTX-9 ako:FZT NPN(BF=200 mfg=X)');
    const netlist = `t\nV1 c 0 DC 5\nRB c b 430k\nQ1 c b 0 ZTX-9\n${models.map((m) => m.card).join('\n')}\n.tran 10u 100u\n.end\n`;
    const result = await runTransient(netlist);
    expect(result.voltages.get('b')![result.time.length - 1]).toBeGreaterThan(0.5);
  });
});

describe('MOSFET models', () => {
  it('takes level 1 parameters and leaves out the rest', () => {
    expect(normalizeModelCard('.model M NMOS(VTO=2 KP=20u NFS=1 mfg=X)')).toMatchObject({ type: 'NMOS', card: '.model M NMOS(VTO=2 KP=20u)', ignored: ['NFS', 'mfg'] });
  });

  it('accepts only level 1, saying why', () => {
    expect(parseModelText('.model M NMOS(LEVEL=1 VTO=2)').models).toHaveLength(1);
    expect(parseModelText('.model M NMOS(VTO=2)').models).toHaveLength(1);
    expect(parseModelText('.model M PMOS(LEVEL=3 VTO=-2)')).toEqual({ models: [], skipped: ['M: per i MOSFET è supportato solo il livello 1, questo è il 3'] });
  });

  it('reads a VDMOS as the channel it has', () => {
    const [n, p] = parseModelText('.model A VDMOS(Vto=2 Kp=1 mfg=X Vds=60)\n.model B VDMOS(pchan Vto=-2 Kp=1)').models;
    expect(n).toMatchObject({ type: 'NMOS', card: '.model A VDMOS(VTO=2 KP=1)', ignored: ['mfg', 'Vds'] });
    expect(p).toMatchObject({ type: 'PMOS', card: '.model B VDMOS(PCHAN VTO=-2 KP=1)' });
    expect(modelType(p.card)).toBe('PMOS');
    expect(isVdmos(p.card)).toBe(true);
    expect(isVdmos('.model M NMOS(VTO=2)')).toBe(false);
  });

  it('keeps the channel through AKO', () => {
    const { models } = parseModelText('.model B VDMOS(pchan Vto=-2 Kp=1)\n.model C ako:B(Kp=2)');
    expect(models[1]).toMatchObject({ type: 'PMOS', card: '.model C VDMOS(PCHAN VTO=-2 KP=2)' });
  });

  it('unwraps a subcircuit around a VDMOS, but not around an NMOS that needs a bulk', () => {
    expect(parseModelText('.subckt X D G S\nM1 D G S V\n.model V VDMOS(Vto=2)\n.ends').models[0]).toMatchObject({ name: 'X', type: 'NMOS' });
    expect(parseModelText('.subckt X D G S\nM1 D G S N\n.model N NMOS(VTO=2)\n.ends').models).toEqual([]);
  });

  it('runs in ngspice in both forms', async () => {
    const { models } = parseModelText('.model A VDMOS(Vto=2 Kp=.5 mfg=X Vds=60 Ron=2)\n.model B NMOS(VTO=2 KP=.5 mfg=X)');
    const netlist = `t\nVD d 0 DC 5\nVG g 0 DC 3\nR1 d x 100\nM1 x g 0 A\nR2 d y 100\nM2 y g 0 0 B\n${models.map((m) => m.card).join('\n')}\n.tran 10u 100u\n.end\n`;
    const result = await runTransient(netlist);
    expect(result.voltages.get('x')![result.time.length - 1]).toBeLessThan(5);
    expect(result.voltages.get('y')![result.time.length - 1]).toBeLessThan(5);
  });
});

describe('names from other simulators', () => {
  it('keeps NK of a transistor under the name ngspice knows', () => {
    expect(normalizeModelCard('.model A NPN(BF=100 Nk=0.6)')).toMatchObject({ card: '.model A NPN(BF=100 NKF=0.6)', ignored: [] });
  });

  it('leaves it out of a diode, which has no such thing', () => {
    expect(normalizeModelCard('.model A D(Nk=0.6)')).toMatchObject({ ignored: ['Nk'] });
  });
});

describe('describeImport', () => {
  it('names a single model', () => {
    expect(describeImport(parseModelText('.model A D(IS=1n mfg=X)'))).toEqual(['Importati A', 'A: ignorati mfg']);
  });

  it('groups models that lost the same parameters', () => {
    const lines = describeImport(parseModelText('.model A D(mfg=X Iave=1)\n.model B D(mfg=X Iave=2)\n.model C D(Vpk=1)\n.model E D(IS=1n)\n.model M NJF(VTO=1)'));
    expect(lines).toEqual(['Importati 4 modelli: A, B, C, E', '2 modelli: ignorati mfg, Iave', 'C: ignorati Vpk', 'M: modello NJF non ancora supportato']);
  });
});

describe('normalizeModelCard', () => {
  it.each(['.model A', '.model bad\nname D(IS=1)', 'R1 a b 1k', '.model a;b D(IS=1)', '.model A NJF(VTO=1)'])('refuses %j', (card) => {
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
