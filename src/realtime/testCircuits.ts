import { getDevice } from '../library/devices';
import { parseModelText } from '../library/modelImport';
import { Circuit, Element, SpiceModel, Wire } from '../model/types';
import { D1N4148 } from '../samples/halfWaveRectifier';

export interface Part {
  def: 'resistor' | 'capacitor' | 'inductor' | 'vsource' | 'diode' | 'zener' | 'npn' | 'pnp' | 'nmos' | 'pmos' | 'opamp';
  tag: string;
  /** In the order of the terminals of the device. */
  nets: string[];
  props: Record<string, string>;
}

const ROW_HEIGHT = 200;
const BUS_X = 1000;
const BUS_SPACING = 20;

/**
 * Lays out a net list as a real drawing: each part on its own row, each net on a vertical bus,
 * wires from terminals to buses. Net "0" is ground. It goes through the same geometry as the editor.
 */
export function circuitFromNets(title: string, parts: Part[]): Circuit {
  const nets = [...new Set(parts.flatMap((p) => p.nets))];
  const busX = new Map(nets.map((net, i) => [net, BUS_X + i * BUS_SPACING]));
  const elements: Element[] = [];
  const wires: Wire[] = [];

  parts.forEach((p, row) => {
    const y = row * ROW_HEIGHT;
    elements.push({ id: p.tag.toLowerCase(), def: p.def, x: 0, y, rot: 0, tag: p.tag, props: p.props });
    getDevice(p.def)!.terminals.forEach((t, i) => {
      // Leads leave on their own level, so that they only ever cross each other
      const leadY = y + (t.y < 0 ? -60 : t.y > 0 ? 80 : t.x < 0 ? 20 : -20);
      wires.push({
        id: `${p.tag}_${t.id}`,
        pts: [
          { x: t.x, y: y + t.y },
          { x: t.x, y: leadY },
          { x: busX.get(p.nets[i])!, y: leadY },
        ],
      });
    });
  });

  const top = -ROW_HEIGHT;
  const bottom = parts.length * ROW_HEIGHT;
  nets.forEach((net) => {
    const x = busX.get(net)!;
    wires.push({ id: `bus_${net}`, pts: [{ x, y: top }, { x, y: bottom }] });
  });
  elements.push({ id: 'gnd', def: 'ground', x: busX.get('0')!, y: bottom, rot: 0, tag: '', props: {} });

  return { title, elements, wires, models: [D1N4148] };
}

const SIN_50HZ = 'SIN(0 10 50)';
const diode = (tag: string, a: string, b: string): Part => ({ def: 'diode', tag, nets: [a, b], props: { model: 'D1N4148' } });
const zener = (tag: string, a: string, b: string): Part => ({ def: 'zener', tag, nets: [a, b], props: { model: 'DZ5V1' } });
const bjt = (def: 'npn' | 'pnp', tag: string, c: string, b: string, e: string, model: string): Part => ({ def, tag, nets: [c, b, e], props: { model } });
const mos = (def: 'nmos' | 'pmos', tag: string, d: string, g: string, s: string, model: string): Part => ({ def, tag, nets: [d, g, s], props: { model } });
/** Nets in the order of the terminals: inverting input, non inverting input, output. */
const opAmp = (tag: string, minus: string, plus: string, out: string, high = '15', low = '-15', gbw = ''): Part => ({ def: 'opamp', tag, nets: [minus, plus, out], props: { high, low, gbw } });
const imported = (text: string) => parseModelText(text).models.map(({ name, card }) => ({ name, card }));
const part = (def: Part['def'], tag: string, a: string, b: string, value: string): Part => ({
  def,
  tag,
  nets: [a, b],
  props: def === 'vsource' ? { spec: value } : { value },
});

/** Divider on the base, collector resistor, no emitter resistor. */
export const RELAXATION_OSCILLATOR: Part[] = [
  opAmp('U1', 'n', 'p', 'out'),
  part('resistor', 'R1', 'out', 'n', '10k'),
  part('capacitor', 'C1', 'n', '0', '1u'),
  part('resistor', 'R2', 'out', 'p', '10k'),
  part('resistor', 'R3', 'p', '0', '10k'),
];

export const SLOW_RELAXATION_OSCILLATOR: Part[] = [opAmp('U1', 'n', 'p', 'out', '15', '-15', '1meg'), ...RELAXATION_OSCILLATOR.slice(1)];

export const BJT_BIAS: Part[] = [
  part('vsource', 'V1', 'vcc', '0', 'DC 10'),
  part('resistor', 'R1', 'vcc', 'c', '1k'),
  part('resistor', 'R2', 'vcc', 'b', '10k'),
  part('resistor', 'R3', 'b', '0', '10k'),
  bjt('npn', 'Q1', 'c', 'b', '0', '2N3904'),
];

export interface TestCase {
  name: string;
  parts: Part[];
  /** Node to compare, by the net name used in parts. */
  probes: string[];
  stop: number;
  dt: number;
  /** Models beyond the library, as imported ones are. */
  models?: SpiceModel[];
}

export const AGREEMENT_CASES: TestCase[] = [
  {
    name: 'partitore in continua',
    parts: [part('vsource', 'V1', 'in', '0', 'DC 12'), part('resistor', 'R1', 'in', 'out', '1k'), part('resistor', 'R2', 'out', '0', '2k')],
    probes: ['out'],
    stop: 1e-3,
    dt: 1e-5,
  },
  {
    name: 'RC con onda quadra',
    parts: [part('vsource', 'V1', 'in', '0', 'PULSE(0 5 0 1u 1u 5m 10m)'), part('resistor', 'R1', 'in', 'out', '1k'), part('capacitor', 'C1', 'out', '0', '1u')],
    probes: ['out'],
    stop: 30e-3,
    dt: 5e-6,
  },
  {
    name: 'RL con onda quadra',
    parts: [part('vsource', 'V1', 'in', '0', 'PULSE(0 5 0 1u 1u 5m 10m)'), part('resistor', 'R1', 'in', 'out', '100'), part('inductor', 'L1', 'out', '0', '100m')],
    probes: ['out'],
    stop: 30e-3,
    dt: 5e-6,
  },
  {
    name: 'RLC serie sinusoidale',
    parts: [
      part('vsource', 'V1', 'in', '0', 'SIN(0 5 1k)'),
      part('resistor', 'R1', 'in', 'a', '20'),
      part('inductor', 'L1', 'a', 'out', '10m'),
      part('capacitor', 'C1', 'out', '0', '1u'),
    ],
    probes: ['out'],
    stop: 10e-3,
    dt: 2e-6,
  },
  {
    name: 'raddrizzatore a semionda',
    parts: [part('vsource', 'V1', 'in', '0', SIN_50HZ), diode('D1', 'in', 'out'), part('resistor', 'R1', 'out', '0', '1k')],
    probes: ['out'],
    stop: 60e-3,
    dt: 10e-6,
  },
  {
    name: 'raddrizzatore a semionda con filtro',
    parts: [part('vsource', 'V1', 'in', '0', SIN_50HZ), diode('D1', 'in', 'out'), part('resistor', 'R1', 'out', '0', '1k'), part('capacitor', 'C1', 'out', '0', '100u')],
    probes: ['out'],
    stop: 100e-3,
    dt: 10e-6,
  },
  {
    name: 'ponte di Graetz',
    parts: [
      part('vsource', 'V1', 'p', 'q', SIN_50HZ),
      diode('D1', 'p', 'out'),
      diode('D2', 'q', 'out'),
      diode('D3', '0', 'p'),
      diode('D4', '0', 'q'),
      part('resistor', 'R1', 'out', '0', '1k'),
    ],
    probes: ['out', 'p'],
    stop: 60e-3,
    dt: 10e-6,
  },
  {
    name: 'sinusoide con offset e fase',
    parts: [
      { def: 'vsource', tag: 'V1', nets: ['in', '0'], props: { shape: 'sin', amplitude: '5', offset: '2', frequency: '1k', phase: '30' } },
      part('resistor', 'R1', 'in', 'out', '1k'),
      part('capacitor', 'C1', 'out', '0', '100n'),
    ],
    probes: ['in', 'out'],
    stop: 5e-3,
    dt: 2e-6,
  },
  {
    name: 'onda quadra dai campi del generatore',
    parts: [
      { def: 'vsource', tag: 'V1', nets: ['in', '0'], props: { shape: 'square', amplitude: '5', offset: '1', frequency: '100' } },
      part('resistor', 'R1', 'in', 'out', '1k'),
      part('capacitor', 'C1', 'out', '0', '1u'),
    ],
    probes: ['out'],
    stop: 30e-3,
    dt: 5e-6,
  },
  {
    name: 'onda quadra con duty cycle del 25%',
    parts: [
      { def: 'vsource', tag: 'V1', nets: ['in', '0'], props: { shape: 'square', amplitude: '5', offset: '0', frequency: '100', duty: '25' } },
      part('resistor', 'R1', 'in', 'out', '1k'),
      part('capacitor', 'C1', 'out', '0', '1u'),
    ],
    probes: ['out'],
    stop: 30e-3,
    dt: 5e-6,
  },
  {
    name: 'stabilizzatore zener',
    parts: [part('vsource', 'V1', 'in', '0', 'SIN(0 12 50)'), part('resistor', 'R1', 'in', 'out', '470'), zener('D1', '0', 'out')],
    probes: ['out'],
    stop: 60e-3,
    dt: 10e-6,
  },
  {
    name: 'zener in conduzione diretta e breakdown con carico',
    parts: [part('vsource', 'V1', 'in', '0', 'SIN(1 20 100)'), part('resistor', 'R1', 'in', 'out', '1k'), zener('D1', '0', 'out'), part('resistor', 'R2', 'out', '0', '10k')],
    probes: ['out'],
    stop: 30e-3,
    dt: 5e-6,
  },
  {
    name: 'NPN: amplificatore a emettitore comune',
    parts: [
      part('vsource', 'VCC', 'vcc', '0', 'DC 12'),
      part('vsource', 'V1', 'sig', '0', 'SIN(0 20m 100)'),
      part('capacitor', 'C1', 'sig', 'b', '10u'),
      part('resistor', 'R1', 'vcc', 'b', '47k'),
      part('resistor', 'R2', 'b', '0', '10k'),
      part('resistor', 'RC', 'vcc', 'c', '2.2k'),
      part('resistor', 'RE', 'e', '0', '470'),
      part('capacitor', 'CE', 'e', '0', '100u'),
      bjt('npn', 'Q1', 'c', 'b', 'e', '2N3904'),
    ],
    probes: ['c', 'b', 'e'],
    stop: 40e-3,
    dt: 10e-6,
  },
  {
    name: 'NPN: interruttore in saturazione',
    parts: [
      part('vsource', 'VCC', 'vcc', '0', 'DC 5'),
      part('vsource', 'V1', 'in', '0', 'PULSE(0 5 0 10u 10u 5m 10m)'),
      part('resistor', 'RB', 'in', 'b', '10k'),
      part('resistor', 'RC', 'vcc', 'c', '1k'),
      bjt('npn', 'Q1', 'c', 'b', '0', '2N3904'),
    ],
    probes: ['c', 'b'],
    stop: 25e-3,
    dt: 5e-6,
  },
  {
    name: 'PNP: inseguitore di emettitore',
    parts: [
      part('vsource', 'VEE', 'vee', '0', 'DC 12'),
      part('vsource', 'V1', 'b', '0', 'SIN(6 2 100)'),
      part('resistor', 'RE', 'vee', 'e', '1k'),
      bjt('pnp', 'Q1', '0', 'b', 'e', '2N3906'),
    ],
    probes: ['e'],
    stop: 30e-3,
    dt: 10e-6,
  },
  {
    name: 'NPN e PNP: push-pull con carico',
    parts: [
      part('vsource', 'VP', 'vp', '0', 'DC 10'),
      part('vsource', 'VN', '0', 'vn', 'DC 10'),
      part('vsource', 'V1', 'b', '0', 'SIN(0 5 100)'),
      bjt('npn', 'Q1', 'vp', 'b', 'out', '2N3904'),
      bjt('pnp', 'Q2', 'vn', 'b', 'out', '2N3906'),
      part('resistor', 'RL', 'out', '0', '1k'),
    ],
    probes: ['out'],
    stop: 30e-3,
    dt: 10e-6,
  },
  {
    name: 'polarizzazione NPN in continua',
    parts: BJT_BIAS,
    probes: ['b', 'c'],
    stop: 1e-3,
    dt: 10e-6,
  },
  {
    name: 'modelli importati: amplificatore e zener da 5,6 V',
    parts: [
      part('vsource', 'VCC', 'vcc', '0', 'DC 12'),
      part('vsource', 'V1', 'sig', '0', 'SIN(0 20m 100)'),
      part('capacitor', 'C1', 'sig', 'b', '10u'),
      part('resistor', 'R1', 'vcc', 'b', '47k'),
      part('resistor', 'R2', 'b', '0', '10k'),
      part('resistor', 'RC', 'vcc', 'c', '2.2k'),
      part('resistor', 'RE', 'e', '0', '470'),
      part('capacitor', 'CE', 'e', '0', '100u'),
      bjt('npn', 'Q1', 'c', 'b', 'e', 'BC547X'),
      part('resistor', 'RZ', 'vcc', 'z', '1k'),
      { def: 'zener', tag: 'D1', nets: ['0', 'z'], props: { model: 'DX5V6' } },
    ],
    probes: ['c', 'b', 'z'],
    stop: 40e-3,
    dt: 10e-6,
    models: parseModelText(`
.MODEL BC547X NPN (IS=1.8E-14 ISE=5.0E-14 NF=.9955 NE=1.46 BF=400 BR=35.5
+ IKF=.14 IKR=.03 ISC=1.72E-13 NC=1.27 NR=1.005 RB=.56 RE=.6 RC=.25 VAF=80 VAR=12.5
+ CJE=13p TF=.64n CJC=4p TR=50.72n Vceo=45 Icrating=100m mfg=Example)
.model DX5V6 D(Is=1n Rs=2 N=1.2 Bv=5.6 Ibv=20m Cjo=100p Iave=500m mfg=Example)
`).models.map(({ name, card }) => ({ name, card })),
  },
  {
    name: 'NPN ad alta corrente con NK importato',
    parts: [
      part('vsource', 'VCC', 'vcc', '0', 'DC 12'),
      part('vsource', 'V1', 'in', '0', 'SIN(3 3 100)'),
      part('resistor', 'RB', 'in', 'b', '1k'),
      part('resistor', 'RC', 'vcc', 'c', '20'),
      bjt('npn', 'Q1', 'c', 'b', '0', 'QK'),
    ],
    probes: ['c', 'b'],
    stop: 30e-3,
    dt: 10e-6,
    models: parseModelText('.model QK NPN(IS=1f BF=300 IKF=10m Nk=0.7 VAF=80 RE=.1 Vceo=45)').models.map(({ name, card }) => ({ name, card })),
  },
  {
    name: 'NMOS: amplificatore a source comune',
    parts: [
      part('vsource', 'VDD', 'vdd', '0', 'DC 12'),
      part('vsource', 'V1', 'g', '0', 'SIN(2.5 200m 100)'),
      part('resistor', 'RD', 'vdd', 'd', '1k'),
      mos('nmos', 'M1', 'd', 'g', '0', 'MN1'),
    ],
    probes: ['d'],
    stop: 30e-3,
    dt: 10e-6,
  },
  {
    name: 'NMOS: interruttore con carico',
    parts: [
      part('vsource', 'VDD', 'vdd', '0', 'DC 12'),
      part('vsource', 'V1', 'g', '0', 'PULSE(0 10 0 2m 2m 4m 12m)'),
      part('resistor', 'RL', 'vdd', 'd', '100'),
      mos('nmos', 'M1', 'd', 'g', '0', 'MN1'),
    ],
    probes: ['d'],
    stop: 25e-3,
    dt: 5e-6,
  },
  {
    name: 'PMOS: source follower',
    parts: [
      part('vsource', 'VDD', 'vdd', '0', 'DC 12'),
      part('vsource', 'V1', 'g', '0', 'SIN(5 2 100)'),
      part('resistor', 'RS', 'vdd', 's', '1k'),
      mos('pmos', 'M1', '0', 'g', 's', 'MP1'),
    ],
    probes: ['s'],
    stop: 30e-3,
    dt: 10e-6,
  },
  {
    name: 'CMOS: invertitore',
    parts: [
      part('vsource', 'VDD', 'vdd', '0', 'DC 10'),
      part('vsource', 'V1', 'in', '0', 'SIN(5 5 5)'),
      mos('pmos', 'M1', 'out', 'in', 'vdd', 'MP1'),
      mos('nmos', 'M2', 'out', 'in', '0', 'MN1'),
      part('resistor', 'RL', 'out', '0', '10k'),
    ],
    probes: ['out'],
    stop: 250e-3,
    dt: 20e-6,
  },
  {
    name: 'NMOS: diodo di body in conduzione e RD, RS',
    parts: [
      part('vsource', 'V1', 'in', '0', 'SIN(0 5 100)'),
      part('vsource', 'VG', 'g', '0', 'DC 0'),
      part('resistor', 'R1', 'in', 'd', '1k'),
      mos('nmos', 'M1', 'd', 'g', '0', 'MR'),
    ],
    probes: ['d'],
    stop: 30e-3,
    dt: 10e-6,
    models: imported('.model MR NMOS(VTO=2 KP=0.05 LAMBDA=0.02 RD=2 RS=1 IS=1e-12 mfg=X)'),
  },
  {
    name: 'VDMOS N: soglia morbida e diodo di body',
    parts: [
      part('vsource', 'VDD', 'vdd', '0', 'DC 10'),
      part('vsource', 'V1', 'g', '0', 'SIN(2 1.2 100)'),
      part('resistor', 'RD', 'vdd', 'd', '50'),
      mos('nmos', 'M1', 'd', 'g', '0', 'VN'),
      part('vsource', 'V2', 'in', '0', 'SIN(0 6 100)'),
      part('resistor', 'R2', 'in', 'x', '100'),
      mos('nmos', 'M2', 'x', '0', '0', 'VN'),
    ],
    probes: ['d', 'x'],
    stop: 30e-3,
    dt: 10e-6,
    models: imported('.model VN VDMOS(Rg=3 Vto=1.6 Rd=.3 Rs=.2 Rb=.1 Kp=.17 Lambda=.01 Cjo=50p Cgs=50p Cgdmax=80p Cgdmin=12p Is=1e-13 N=1.1 Vds=60 Ron=2 Qg=1.5n mfg=Prova)'),
  },
  {
    name: 'VDMOS P: mtriode e breakdown del body',
    parts: [
      part('vsource', 'VDD', 'vdd', '0', 'DC 10'),
      part('vsource', 'V1', 'g', '0', 'SIN(7 3 100)'),
      part('resistor', 'RD', 'd', '0', '100'),
      mos('pmos', 'M1', 'd', 'g', 'vdd', 'VP'),
    ],
    probes: ['d'],
    stop: 30e-3,
    dt: 10e-6,
    models: imported('.model VP VDMOS(pchan Vto=-2 Kp=.3 Lambda=.01 mtriode=1.3 ksubthres=.05 Rd=.2 Rs=.1 Bv=60 Ibv=1u mfg=Prova)'),
  },
  {
    name: 'op amp: invertente',
    parts: [part('vsource', 'V1', 'in', '0', 'SIN(0 1 100)'), part('resistor', 'R1', 'in', 'n', '1k'), part('resistor', 'R2', 'n', 'out', '10k'), opAmp('U1', 'n', '0', 'out')],
    probes: ['out', 'n'],
    stop: 30e-3,
    dt: 10e-6,
  },
  {
    name: 'op amp: non invertente in saturazione',
    parts: [part('vsource', 'V1', 'in', '0', 'SIN(1 2 100)'), part('resistor', 'R1', 'n', '0', '1k'), part('resistor', 'R2', 'n', 'out', '9k'), opAmp('U1', 'n', 'in', 'out', '12', '-5')],
    probes: ['out'],
    stop: 30e-3,
    dt: 10e-6,
  },
  {
    name: 'op amp: sommatore',
    parts: [
      part('vsource', 'V1', 'a', '0', 'SIN(0 1 100)'),
      part('vsource', 'V2', 'b', '0', 'DC 0.5'),
      part('resistor', 'R1', 'a', 'n', '1k'),
      part('resistor', 'R2', 'b', 'n', '2k'),
      part('resistor', 'R3', 'n', 'out', '4k'),
      opAmp('U1', 'n', '0', 'out'),
    ],
    probes: ['out'],
    stop: 30e-3,
    dt: 10e-6,
  },
  {
    name: 'op amp: integratore',
    parts: [
      part('vsource', 'V1', 'in', '0', 'PULSE(-1 1 0 100u 100u 4.9m 10m)'),
      part('resistor', 'R1', 'in', 'n', '10k'),
      part('capacitor', 'C1', 'n', 'out', '1u'),
      part('resistor', 'R2', 'n', 'out', '1meg'),
      opAmp('U1', 'n', '0', 'out'),
    ],
    probes: ['out'],
    stop: 50e-3,
    dt: 10e-6,
  },
  {
    name: 'op amp: raddrizzatore di precisione',
    parts: [
      part('vsource', 'V1', 'in', '0', 'SIN(0 1 100)'),
      opAmp('U1', 'out', 'in', 'x'),
      { def: 'diode', tag: 'D1', nets: ['x', 'out'], props: { model: 'DDC' } },
      part('resistor', 'R1', 'out', '0', '10k'),
    ],
    probes: ['out'],
    stop: 30e-3,
    dt: 5e-6,
    // Without capacitances: those of a real diode show up when the output jumps from rail to rail
    models: imported('.model DDC D(IS=2.52n RS=0.568 N=1.752)'),
  },
  {
    name: 'op amp con GBW: guadagno 1000 oltre la banda',
    parts: [part('vsource', 'V1', 'in', '0', 'SIN(0 10m 5k)'), part('resistor', 'R1', 'n', '0', '100'), part('resistor', 'R2', 'n', 'out', '99.9k'), opAmp('U1', 'n', 'in', 'out', '15', '-15', '1meg')],
    probes: ['out'],
    stop: 2e-3,
    dt: 1e-6,
  },
  {
    name: 'op amp con GBW: entra e esce dalla saturazione',
    parts: [part('vsource', 'V1', 'in', '0', 'SIN(0 2 100)'), part('resistor', 'R1', 'in', 'n', '1k'), part('resistor', 'R2', 'n', 'out', '10k'), opAmp('U1', 'n', '0', 'out', '15', '-15', '1meg')],
    probes: ['out'],
    stop: 30e-3,
    dt: 5e-6,
  },
  {
    name: 'op amp con GBW: integratore',
    parts: [
      part('vsource', 'V1', 'in', '0', 'PULSE(-1 1 0 100u 100u 4.9m 10m)'),
      part('resistor', 'R1', 'in', 'n', '10k'),
      part('capacitor', 'C1', 'n', 'out', '1u'),
      part('resistor', 'R2', 'n', 'out', '1meg'),
      opAmp('U1', 'n', '0', 'out', '15', '-15', '1meg'),
    ],
    probes: ['out'],
    stop: 50e-3,
    dt: 10e-6,
  },
  {
    name: 'limitatore a diodi in antiparallelo',
    parts: [part('vsource', 'V1', 'in', '0', SIN_50HZ), part('resistor', 'R1', 'in', 'out', '1k'), diode('D1', 'out', '0'), diode('D2', '0', 'out')],
    probes: ['out'],
    stop: 60e-3,
    dt: 10e-6,
  },
];
