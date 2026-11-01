import { Circuit, ModelType, SpiceModel } from '../model/types';
import { getDevice } from './devices';

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

const LIBRARY: SpiceModel[] = [D1N4148, DZ5V1, Q2N3904, Q2N3906];

/** A model of the circuit, or of the library. The circuit's own take precedence. */
export function findModel(circuit: Circuit, name: string): SpiceModel | undefined {
  return circuit.models.find((m) => m.name === name) ?? LIBRARY.find((m) => m.name === name);
}

export function modelType(card: string): string | null {
  return /^\s*\.model\s+\S+\s+([a-z]+)/i.exec(card)?.[1].toUpperCase() ?? null;
}

/** Circuit first, then the personal library, then the built-in models, each name once. */
export function modelsOfType(circuit: Circuit, type: ModelType, library: SpiceModel[] = []): SpiceModel[] {
  const seen = new Set<string>();
  return [...circuit.models, ...library, ...LIBRARY].filter((m) => {
    if (seen.has(m.name) || modelType(m.card) !== type) return false;
    seen.add(m.name);
    return true;
  });
}

export const isBuiltInModel = (model: SpiceModel) => LIBRARY.some((m) => m.name === model.name && m.card === model.card);

/** The model names the parts of the circuit refer to, each once. */
function usedModelNames(circuit: Circuit): string[] {
  const names = circuit.elements.flatMap((el) => {
    const spice = getDevice(el.def)?.spice;
    return spice && (spice.kind === 'diode' || spice.kind === 'bjt') ? [String(el.props[spice.modelProp] ?? '')] : [];
  });
  return [...new Set(names)];
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
