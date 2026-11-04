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

const sevenSegment = (): Circuit => {
  // The digit 5 at the start: D C B A = 0 1 0 1
  const bits = { D: '0', C: '1', B: '0', A: '1' };
  const names = ['D', 'C', 'B', 'A'] as const;
  // The inputs further apart than the pins of the driver, so that their boxes and names do not touch
  const inputY = (k: number) => -105 + 50 * k;
  const pinY = (k: number) => -30 + 20 * k;
  const segments = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  const segmentY = (k: number) => -60 + 20 * k;
  // Resistors on two columns, so that each name and value has room
  const resistorX = (k: number) => (k % 2 === 0 ? 100 : 180);
  return {
    title: 'Driver BCD e display a 7 segmenti',
    elements: [
      ...names.map((name, k) => part(`in${name}`, 'logicinput', -160, inputY(k), 0, `IN${name}`, { state: bits[name] })),
      part('u1', 'bcd7seg', 0, 0, 0, 'U1'),
      ...segments.map((name, k) => part(`r${name}`, 'resistor', resistorX(k), segmentY(k), 0, `R${k + 1}`, { value: '220' })),
      part('ds1', 'display7', 320, 0, 0, 'DS1', { color: 'rosso' }),
      ground(380, 40),
    ],
    wires: [
      // Each wire turns at its own x: on a shared one the vertical runs would lie on top of each other
      ...names.map((name, k) => wire(`win${name}`, [-120, inputY(k)], [-100 + 15 * k, inputY(k)], [-100 + 15 * k, pinY(k)], [-40, pinY(k)])),
      ...segments.flatMap((name, k) => [
        wire(`wo${name}`, [40, segmentY(k)], [resistorX(k) - 40, segmentY(k)]),
        wire(`ws${name}`, [resistorX(k) + 40, segmentY(k)], [280, segmentY(k)]),
      ]),
      wire('wk', [360, 0], [380, 0], [380, 40]),
    ],
    models: [],
  };
};

const counterDisplay = (): Circuit => {
  const pinY = (k: number) => -30 + 20 * k;
  const segments = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  const segmentY = (k: number) => -60 + 20 * k;
  const resistorX = (k: number) => (k % 2 === 0 ? 100 : 180);
  return {
    title: 'Contatore decimale e display',
    elements: [
      part('ck1', 'clock', -300, -10, 0, 'CK1', { frequency: '1' }),
      part('u2', 'counter4', -160, 0, 0, 'U2', { modulus: '10' }),
      part('u1', 'bcd7seg', 0, 0, 0, 'U1'),
      ...segments.map((name, k) => part(`r${name}`, 'resistor', resistorX(k), segmentY(k), 0, `R${k + 1}`, { value: '220' })),
      part('ds1', 'display7', 320, 0, 0, 'DS1', { color: 'rosso' }),
      part('inr', 'logicinput', -260, 40, 0, 'IN1', { state: '0' }),
      ground(380, 40),
    ],
    wires: [
      wire('wclk', [-260, -10], [-200, -10]),
      wire('wrst', [-220, 40], [-210, 40], [-210, 10], [-200, 10]),
      ...[0, 1, 2, 3].map((k) => wire(`wq${k}`, [-120, pinY(k)], [-40, pinY(k)])),
      ...segments.flatMap((name, k) => [
        wire(`wo${name}`, [40, segmentY(k)], [resistorX(k) - 40, segmentY(k)]),
        wire(`ws${name}`, [resistorX(k) + 40, segmentY(k)], [280, segmentY(k)]),
      ]),
      wire('wk', [360, 0], [380, 0], [380, 40]),
    ],
    models: [],
  };
};

const dualSupply = (): Circuit => ({
  title: 'Alimentatore duale con presa centrale',
  elements: [
    part('v1', 'vsource', -280, 0, 90, 'V1', sine('325', '50')),
    part('t1', 'cttransformer', -100, 0, 0, 'T1'),
    // Turned so that the alternating inputs face left and right, the positive up, the negative down
    part('d1', 'bridge', 40, 0, 270, 'D1'),
    part('c1', 'capacitor', 160, -20, 90, 'C1', { value: '2200u' }),
    part('rl1', 'resistor', 240, -20, 90, 'RL1', { value: '100' }),
    part('c2', 'capacitor', 160, 100, 90, 'C2', { value: '2200u' }),
    part('rl2', 'resistor', 240, 100, 90, 'RL2', { value: '100' }),
    ground(-280, 80),
    ground(-40, 0, 'gnd2'),
    // Beside the point between the two capacitors and between the two loads, as drawn by hand
    ground(200, 40, 'gnd3'),
    ground(280, 40, 'gnd4'),
  ],
  wires: [
    wire('w1', [-280, -40], [-140, -40]),
    wire('w2', [-280, 40], [-140, 40]),
    wire('w3', [-280, 40], [-280, 80]),
    wire('w4', [-60, -40], [-20, -40], [-20, 0], [0, 0]),
    wire('w5', [-60, 0], [-40, 0]),
    wire('w6', [-60, 40], [-40, 40], [-40, 100], [100, 100], [100, 0], [80, 0]),
    wire('w7', [40, -40], [40, -60], [240, -60]),
    wire('w8', [160, 20], [160, 60]),
    wire('w9', [240, 20], [240, 60]),
    wire('w11', [160, 40], [200, 40]),
    wire('w12', [240, 40], [280, 40]),
    wire('w10', [40, 40], [40, 140], [240, 140]),
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

const sensors = (): Circuit => ({
  title: 'Sensori di temperatura LM35 e TMP36',
  elements: [
    part('v1', 'dcsupply', 0, 0, 90, 'V1', { amplitude: '5' }),
    part('u1', 'lm35', 120, -60, 0, 'U1', { temp: '25' }),
    part('u2', 'tmp36', 320, -60, 0, 'U2', { temp: '25' }),
    part('mm1', 'multimetercompact', 200, 0, 90, 'MM1', { mode: 'vdc' }),
    part('mm2', 'multimetercompact', 400, 0, 90, 'MM2', { mode: 'vdc' }),
    ground(60, 80),
  ],
  wires: [
    wire('w1', [0, -40], [0, -60], [80, -60]),
    wire('w2', [40, -60], [40, -100], [260, -100], [260, -60], [280, -60]),
    wire('w3', [160, -60], [200, -60], [200, -40]),
    wire('w4', [360, -60], [400, -60], [400, -40]),
    wire('w5', [0, 40], [0, 80], [400, 80], [400, 40]),
    wire('w6', [120, -20], [120, 80]),
    wire('w7', [320, -20], [320, 80]),
    wire('w8', [200, 40], [200, 80]),
  ],
  models: [],
});

const gearMotor = (): Circuit => ({
  title: 'Motoriduttore IG22',
  elements: [
    part('v1', 'dcsupply', 0, 40, 90, 'V1', { amplitude: '12' }),
    part('s1', 'switch', 80, 0, 0, 'S1'),
    part('mm1', 'multimetercompact', 200, 0, 0, 'MM1', { mode: 'adc' }),
    part('m1', 'motor_ig22', 320, 40, 90, 'M1', { load: '0' }),
    // The freewheeling diode: at turn-off it carries the current of the winding, which would otherwise spark
    part('d1', 'diode', 420, 40, 270, 'D1', { model: 'DIODO_1A' }),
    ground(160, 80),
  ],
  wires: [
    wire('w1', [0, 0], [40, 0]),
    wire('w2', [120, 0], [160, 0]),
    wire('w3', [240, 0], [320, 0]),
    wire('w4', [320, 0], [420, 0]),
    wire('w5', [0, 80], [320, 80]),
    wire('w6', [320, 80], [420, 80]),
  ],
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
  { id: 'sevenseg', title: 'Driver BCD e display a 7 segmenti', hint: 'Tocca gli ingressi D C B A: il display mostra la cifra del numero binario, da 0 a 9', build: sevenSegment },
  { id: 'counter', title: 'Contatore decimale e display', hint: 'Un clock da 1 Hz fa avanzare il contatore: il display conta da 0 a 9 e ricomincia. Tocca IN1 per portare RST a 1 e azzerarlo', build: counterDisplay },
  { id: 'dual', title: 'Alimentatore duale con presa centrale', hint: 'Trasformatore 230 V → 12+12 V, ponte di Graetz e due condensatori: circa +17 V e −17 V rispetto alla presa centrale', build: dualSupply },
  { id: 'motor', title: 'Motoriduttore IG22', hint: 'Chiudi S1: all’avvio la corrente fa uno spunto, poi scende a circa 0,2 A e il motore gira a 789 giri/min. Alza il carico di M1: la velocità scende e la corrente sale', build: gearMotor },
  { id: 'sensors', title: 'Sensori di temperatura LM35 e TMP36', hint: 'Sposta la temperatura nelle proprietà di U1 e U2: 10 mV per grado. LM35: 0 V a 0 °C; TMP36: 0,5 V a 0 °C', build: sensors },
  { id: 'regulator', title: 'Regolatore 7805', hint: '5 V sul carico da 100 Ω: guarda la potenza e la temperatura del regolatore', build: regulator },
];
