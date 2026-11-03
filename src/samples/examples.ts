import { getDevice } from '../library/devices';
import { Circuit, Element, Pt, Rotation, Wire } from '../model/types';
import { halfWaveRectifier } from './halfWaveRectifier';

export interface Example {
  id: string;
  title: string;
  /** What to look at, for whoever opens it in a lesson. */
  hint: string;
  build: () => Circuit;
}

/** A part with the defaults of the library, and only the values the example sets. */
const part = (id: string, def: string, x: number, y: number, rot: Rotation, tag: string, props: Record<string, string> = {}): Element => ({
  id,
  def,
  x,
  y,
  rot,
  tag,
  props: { ...Object.fromEntries(getDevice(def)!.props.map((p) => [p.key, p.default])), ...props },
});

const wire = (id: string, ...pts: [number, number][]): Wire => ({ id, pts: pts.map(([x, y]): Pt => ({ x, y })) });

const ground = (x: number, y: number, id = 'gnd') => part(id, 'ground', x, y, 0, '');

const sine = (amplitude: string, frequency: string) => ({ shape: 'sin', amplitude, offset: '0', frequency });

const divider = (): Circuit => ({
  title: 'Partitore di tensione',
  elements: [
    part('v1', 'dcsupply', 0, 0, 90, 'V1', { amplitude: '12' }),
    part('r1', 'resistor', 120, -60, 90, 'R1', { value: '10k' }),
    part('r2', 'resistor', 120, 60, 90, 'R2', { value: '4.7k' }),
    part('mm1', 'multimetercompact', 220, 60, 90, 'MM1', { mode: 'vdc' }),
    ground(60, 100),
  ],
  wires: [
    wire('w1', [0, -40], [0, -100], [120, -100]),
    wire('w2', [120, -20], [120, 20]),
    wire('w3', [120, 20], [220, 20]),
    wire('w4', [0, 40], [0, 100], [220, 100]),
  ],
  models: [],
});

const lowPass = (): Circuit => ({
  title: 'Filtro RC passa-basso',
  elements: [
    part('v1', 'vsource', 0, 0, 90, 'V1', sine('1', '1k')),
    part('r1', 'resistor', 80, -40, 0, 'R1', { value: '1k' }),
    part('c1', 'capacitor', 160, 0, 90, 'C1', { value: '100n' }),
    ground(80, 40),
  ],
  wires: [wire('w1', [0, -40], [40, -40]), wire('w2', [120, -40], [160, -40]), wire('w3', [0, 40], [160, 40])],
  models: [],
});

const zener = (): Circuit => ({
  title: 'Stabilizzatore con zener',
  elements: [
    part('v1', 'dcsupply', 0, 0, 90, 'V1', { amplitude: '12' }),
    part('r1', 'resistor', 80, -40, 0, 'R1', { value: '470' }),
    part('d1', 'zener', 160, 0, 270, 'D1'),
    part('rl', 'resistor', 240, 0, 90, 'RL', { value: '1k' }),
    ground(120, 40),
  ],
  wires: [wire('w1', [0, -40], [40, -40]), wire('w2', [120, -40], [240, -40]), wire('w3', [0, 40], [240, 40])],
  models: [],
});

const inverting = (): Circuit => ({
  title: 'Amplificatore invertente',
  elements: [
    part('v1', 'vsource', 0, 50, 90, 'V1', sine('0.5', '1k')),
    part('r1', 'resistor', 80, 0, 0, 'R1', { value: '10k' }),
    part('rf', 'resistor', 200, -80, 0, 'RF', { value: '100k' }),
    part('u1', 'opamp', 200, 10, 0, 'U1'),
    part('rl', 'resistor', 300, 50, 90, 'RL', { value: '10k' }),
    ground(100, 90),
  ],
  wires: [
    wire('w1', [0, 10], [0, 0], [40, 0]),
    wire('w2', [120, 0], [160, 0]),
    wire('w3', [140, 0], [140, -80], [160, -80]),
    wire('w4', [240, -80], [240, 10]),
    wire('w5', [240, 10], [300, 10]),
    wire('w6', [160, 20], [160, 90]),
    wire('w7', [0, 90], [300, 90]),
  ],
  models: [],
});

const transistorSwitch = (): Circuit => ({
  title: 'Transistor come interruttore',
  elements: [
    part('v1', 'dcsupply', 0, 0, 90, 'V1', { amplitude: '12' }),
    part('v2', 'vsource', 80, 80, 90, 'V2', { shape: 'square', amplitude: '2.5', offset: '2.5', frequency: '1' }),
    part('rb', 'resistor', 160, 40, 0, 'RB', { value: '10k' }),
    part('rc', 'resistor', 260, -60, 90, 'RC', { value: '1k' }),
    part('q1', 'npn', 240, 40, 0, 'Q1'),
    ground(160, 120),
  ],
  wires: [
    wire('w1', [0, -40], [0, -100], [260, -100]),
    wire('w2', [260, -20], [260, 0]),
    wire('w3', [80, 40], [120, 40]),
    wire('w4', [0, 40], [0, 120], [260, 120]),
    wire('w5', [260, 80], [260, 120]),
  ],
  models: [],
});

const gates = (): Circuit => ({
  title: 'Porte logiche e LED',
  elements: [
    part('in1', 'logicinput', 0, -40, 0, 'IN1', { state: '1' }),
    part('in2', 'logicinput', 0, 40, 0, 'IN2'),
    part('u1', 'gate_and', 120, -40, 0, 'U1'),
    part('u2', 'gate_xor', 120, 80, 0, 'U2'),
    part('r1', 'resistor', 200, -40, 0, 'R1', { value: '220' }),
    part('r2', 'resistor', 200, 80, 0, 'R2', { value: '220' }),
    part('d1', 'led', 280, 0, 90, 'D1', { model: 'LED_ROSSO' }),
    part('d2', 'led', 280, 120, 90, 'D2', { model: 'LED_VERDE' }),
    ground(280, 160),
  ],
  wires: [
    wire('w1', [40, -40], [60, -40], [60, -50], [80, -50]),
    wire('w2', [60, -40], [60, 70], [80, 70]),
    wire('w3', [40, 40], [50, 40], [50, -30], [80, -30]),
    wire('w4', [50, 40], [50, 90], [80, 90]),
    wire('w5', [240, -40], [280, -40]),
    wire('w6', [240, 80], [280, 80]),
    wire('w7', [280, 40], [300, 40], [300, 160], [280, 160]),
  ],
  models: [],
});

const switches = (): Circuit => ({
  title: 'Pulsante, interruttore e porta logica',
  elements: [
    part('v1', 'dcsupply', -120, 40, 90, 'V1', { amplitude: '5' }),
    part('s1', 'switch', 0, 0, 0, 'S1'),
    part('s2', 'pushno', 0, 160, 0, 'S2'),
    part('r1', 'resistor', 60, 40, 90, 'R1', { value: '10k' }),
    part('r2', 'resistor', 80, 200, 90, 'R2', { value: '10k' }),
    part('u1', 'gate_and', 160, 50, 0, 'U1'),
    part('r3', 'resistor', 240, 50, 0, 'R3', { value: '220' }),
    part('d1', 'led', 300, 90, 90, 'D1', { model: 'LED_VERDE' }),
    // A ground under each part that needs one, as in a schematic drawn by hand
    ground(-120, 120),
    ground(60, 100, 'gnd2'),
    ground(80, 260, 'gnd3'),
    ground(300, 150, 'gnd4'),
  ],
  wires: [
    wire('w1', [-120, 0], [-40, 0]),
    wire('w2', [-60, 0], [-60, 160], [-40, 160]),
    wire('w3', [40, 0], [60, 0]),
    wire('w4', [60, 0], [100, 0], [100, 40], [120, 40]),
    wire('w5', [40, 160], [80, 160]),
    wire('w6', [80, 160], [100, 160], [100, 60], [120, 60]),
    wire('w7', [280, 50], [300, 50]),
    wire('w8', [-120, 80], [-120, 120]),
    wire('w9', [60, 80], [60, 100]),
    wire('w10', [80, 240], [80, 260]),
    wire('w11', [300, 130], [300, 150]),
  ],
  models: [],
});

const regulator = (): Circuit => ({
  title: 'Regolatore 7805',
  elements: [
    part('v1', 'dcsupply', 0, 0, 90, 'V1', { amplitude: '12' }),
    part('u1', 'reg7805', 120, -40, 0, 'U1'),
    part('rl', 'resistor', 240, 0, 90, 'RL', { value: '100' }),
    ground(60, 40),
  ],
  wires: [wire('w1', [0, -40], [80, -40]), wire('w2', [160, -40], [240, -40]), wire('w3', [120, 0], [120, 40]), wire('w4', [0, 40], [240, 40])],
  models: [],
});

/** What Nuovo opens: an empty sheet, but with the ground that every circuit needs. */
export const emptyCircuit = (): Circuit => ({ title: 'Circuito', elements: [ground(0, 0)], wires: [], models: [] });

export const EXAMPLES: Example[] = [
  { id: 'divider', title: 'Partitore di tensione', hint: 'Il multimetro legge 12 V × 4,7k / 14,7k, circa 3,84 V', build: divider },
  { id: 'rectifier', title: 'Raddrizzatore a semionda', hint: 'Con l’Analisi precisa si vede il ripple sul condensatore', build: () => halfWaveRectifier({ capacitor: '100u' }) },
  { id: 'lowpass', title: 'Filtro RC passa-basso', hint: 'Con l’analisi In frequenza il taglio è a 1/(2πRC), circa 1,59 kHz', build: lowPass },
  { id: 'zener', title: 'Stabilizzatore con zener', hint: 'Il carico resta a circa 5,1 V: lo zener prende la corrente in più', build: zener },
  { id: 'inverting', title: 'Amplificatore invertente', hint: 'Guadagno −RF/R1 = −10: 0,5 V in ingresso, 5 V in uscita, in opposizione', build: inverting },
  { id: 'switch', title: 'Transistor come interruttore', hint: 'Un’onda quadra tra 0 e 5 V, a 1 Hz, accende e spegne la corrente nel collettore', build: transistorSwitch },
  { id: 'gates', title: 'Porte logiche e LED', hint: 'Tocca 0 e 1 sugli ingressi: il LED rosso si accende con AND, il verde con XOR', build: gates },
  { id: 'switches', title: 'Pulsante, interruttore e porta logica', hint: 'Chiudi l’interruttore e tieni premuto il pulsante: il LED si accende solo con entrambi', build: switches },
  { id: 'regulator', title: 'Regolatore 7805', hint: '5 V sul carico da 100 Ω: guarda la potenza e la temperatura del regolatore', build: regulator },
];
