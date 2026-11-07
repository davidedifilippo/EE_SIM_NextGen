import { Circuit, ModelType, SpiceModel } from '../model/types';
import { getDevice } from './devices';
import { STANDARD_MODELS } from './standardModels';

/** Commonly published parameters of real parts, except the zener, which is a generic 5.1 V one. */
export const D1N4148: SpiceModel = {
  name: 'D1N4148',
  card: '.model D1N4148 D(IS=2.52n RS=0.568 N=1.752 BV=100 IBV=100u CJO=4p M=0.333 VJ=0.75 TT=11.54n)',
};
const DZ5V1: SpiceModel = { name: 'DZ5V1', card: '.model DZ5V1 D(IS=1n RS=1 N=1.5 BV=5.1 IBV=5m)' };
const Q2N3904: SpiceModel = {
  name: '2N3904',
  card: '.model 2N3904 NPN(IS=6.734f VAF=74.03 BF=416.4 NE=1.259 ISE=6.734f IKF=66.78m BR=.7371 NC=2 ISC=0 IKR=0 RC=1 CJC=3.638p MJC=.3085 VJC=.75 FC=.5 CJE=4.493p MJE=.2593 VJE=.75 TR=239.5n TF=301.2p ITF=.4 VTF=4 XTF=2 RB=10)',
};
const Q2N3906: SpiceModel = {
  name: '2N3906',
  card: '.model 2N3906 PNP(IS=1.41f VAF=18.7 BF=180.7 NE=1.5 ISE=0 IKF=80m BR=4.977 NC=2 ISC=0 IKR=0 RC=2.5 CJC=9.728p MJC=.5776 VJC=.75 FC=.5 CJE=8.063p MJE=.3677 VJE=.75 TR=33.42n TF=179.3p ITF=.4 VTF=4 XTF=2 RB=10)',
};

/** Generic parts of level 1, with round values for lessons. */
const MN1: SpiceModel = { name: 'MN1', card: '.model MN1 NMOS(VTO=2 KP=0.2 LAMBDA=0.01)' };
const MP1: SpiceModel = { name: 'MP1', card: '.model MP1 PMOS(VTO=-2 KP=0.1 LAMBDA=0.01)' };

/**
 * LEDs by colour, sized for their usual forward voltage at 10 mA: about 1.9 V for red, 2 V yellow,
 * 2.1 V green, 3 V blue and 3.1 V white. Generic, not the parts of a maker.
 */
/** A generic rectifier diode of 1 A and 1000 V, for bridges and power supplies: round values, not the part of a maker. */
export const DIODE_1A: SpiceModel = { name: 'DIODO_1A', card: '.model DIODO_1A D(IS=7n RS=0.04 N=1.8 BV=1000 IBV=5n)' };

export const LED_MODELS: SpiceModel[] = [
  { name: 'LED_ROSSO', card: '.model LED_ROSSO D(IS=2.94e-18 N=2 RS=5)' },
  { name: 'LED_GIALLO', card: '.model LED_GIALLO D(IS=4.26e-19 N=2 RS=5)' },
  { name: 'LED_VERDE', card: '.model LED_VERDE D(IS=6.16e-20 N=2 RS=5)' },
  { name: 'LED_BLU', card: '.model LED_BLU D(IS=1.71e-27 N=2 RS=5)' },
  { name: 'LED_BIANCO', card: '.model LED_BIANCO D(IS=2.48e-28 N=2 RS=5)' },
];

const LIBRARY: SpiceModel[] = [D1N4148, DZ5V1, Q2N3904, Q2N3906, MN1, MP1, DIODE_1A, ...LED_MODELS, ...STANDARD_MODELS];

/** A model of the circuit, or of the library. The circuit's own take precedence. */
export function findModel(circuit: Circuit, name: string): SpiceModel | undefined {
  return circuit.models.find((m) => m.name === name) ?? LIBRARY.find((m) => m.name === name);
}

/** A VDMOS counts as the N or P channel part it is: only the netlist and the engine see the difference. */
export function modelType(card: string): string | null {
  if (isSubcircuitCard(card)) return subcircuitPins(card).length === OPAMP_PINS ? 'OPAMP' : 'SUBCKT';
  const type = /^\s*\.model\s+\S+\s+([a-z]+)/i.exec(card)?.[1].toUpperCase() ?? null;
  if (type !== 'VDMOS') return type;
  return /[\s(]pchan\b/i.test(card) ? 'PMOS' : 'NMOS';
}

export const isSubcircuitCard = (card: string) => /^\s*\.subckt\s/i.test(card);

export const OPAMP_PINS = 5;

/** Name, pins and parameters of a .subckt line. */
export function splitSubcircuitHead(head: string) {
  const [, name = '', ...rest] = head.trim().split(/\s+/);
  const paramsAt = rest.findIndex((token) => token.toLowerCase() === 'params:' || token.includes('='));
  return { name, pins: paramsAt < 0 ? rest : rest.slice(0, paramsAt), params: paramsAt < 0 ? '' : rest.slice(paramsAt).join(' ').replace(/^params:\s*/i, '') };
}

/** The pins of a subcircuit card, or of its first line. */
export const subcircuitPins = (card: string) => splitSubcircuitHead(card.split('\n')[0]).pins;

export const isVdmos = (card: string) => /^\s*\.model\s+\S+\s+vdmos\b/i.test(card);

export const REGULATOR_PINS = 3;

export function fitsModelType(card: string, type: ModelType): boolean {
  if (type === 'SUBCKT') return isSubcircuitCard(card);
  if (type === 'REGULATOR') return isSubcircuitCard(card) && subcircuitPins(card).length === REGULATOR_PINS;
  return modelType(card) === type;
}

/** Circuit first, then the personal library, then the built-in models, each name once. */
export function modelsOfType(circuit: Circuit, type: ModelType, library: SpiceModel[] = []): SpiceModel[] {
  const seen = new Set<string>();
  return [...circuit.models, ...library, ...LIBRARY].filter((m) => {
    // A block takes any subcircuit, those with five pins too: not all of them are op amps
    const fits = fitsModelType(m.card, type);
    if (seen.has(m.name) || !fits) return false;
    seen.add(m.name);
    return true;
  });
}

export const isBuiltInModel = (model: SpiceModel) => LIBRARY.some((m) => m.name === model.name && m.card === model.card);

/** The model names the parts of the circuit refer to, each once. */
export function usedModelNames(circuit: Circuit): string[] {
  const names = circuit.elements.flatMap((el) => {
    const spice = getDevice(el.def)?.spice;
    if (spice?.kind === 'regulator') return [String(el.props.model ?? '')];
    return spice && (spice.kind === 'diode' || spice.kind === 'bjt' || spice.kind === 'mos' || spice.kind === 'opamp' || spice.kind === 'block') ? [String(el.props[spice.modelProp] ?? '')] : [];
  });
  return [...new Set(names)].filter(Boolean);
}

/** The circuit as the engines must see it: they run apart from the page and cannot read the library. */
export function withLibraryModels(circuit: Circuit, library: SpiceModel[]): Circuit {
  const own = new Set(circuit.models.map((m) => m.name));
  const needed = usedModelNames(circuit).flatMap((name) => (own.has(name) ? [] : library.filter((m) => m.name === name)));
  return needed.length > 0 ? { ...circuit, models: [...circuit.models, ...needed] } : circuit;
}

/** What goes into a file: the models in use and no others, built-in ones too, so that it works anywhere and gives the same results. */
export function circuitForSaving(circuit: Circuit, library: SpiceModel[]): Circuit {
  const resolved = withLibraryModels(circuit, library);
  const models = usedModelNames(circuit).flatMap((name) => {
    const model = findModel(resolved, name);
    return model ? [model] : [];
  });
  return { ...circuit, models };
}
