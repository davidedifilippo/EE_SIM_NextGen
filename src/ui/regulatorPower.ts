import { getDevice } from '../library/devices';
import { Circuit } from '../model/types';
import { TranResult } from '../engine/ngspice';
import { terminalKey } from '../netlist/connectivity';
import { cardName } from '../netlist/generate';
import { regulatorParams, regulatorPower, THERMAL_SHUTDOWN } from '../realtime/regulator';

export interface RegulatorSummary {
  tag: string;
  name: string;
  /** Mean over the whole analysis. */
  power: number;
  /** The junction at rest with that power. */
  temperature: number;
  wouldShutDown: boolean;
}

/** Mean of samples at uneven times, each interval counting for its length. */
function timeMean(time: number[], values: number[]): number {
  const span = time[time.length - 1] - time[0];
  if (!(span > 0)) return values[values.length - 1] ?? 0;
  let area = 0;
  for (let k = 1; k < time.length; k++) area += ((values[k] + values[k - 1]) / 2) * (time[k] - time[k - 1]);
  return area / span;
}

/**
 * What each regulator dissipated, from the results of the precise analysis, whatever computed them.
 * The models of the manufacturers rarely hold the thermal protection, so it is worked out here.
 */
export function regulatorSummaries(circuit: Circuit, nodeOf: Map<string, string>, result: TranResult): RegulatorSummary[] {
  return circuit.elements.flatMap((el): RegulatorSummary[] => {
    const def = getDevice(el.def);
    if (def?.spice.kind !== 'regulator') return [];
    const params = regulatorParams(el, def.spice);
    const current = result.currents.get(`vs${cardName('X', el.tag)}`.toLowerCase());
    if (!params || !current) return [];

    const series = (terminal: string) => {
      const node = nodeOf.get(terminalKey(el.id, terminal));
      return (node && result.voltages.get(node.toLowerCase())) || result.time.map(() => 0);
    };
    const [input, output, reference] = [series(def.spice.input), series(def.spice.output), series(def.spice.ref)];
    const { polarity: p } = params;
    const heat = result.time.map((_, k) => regulatorPower(params, p * (input[k] - reference[k]), p * (output[k] - reference[k]), p * current[k]));
    const power = timeMean(result.time, heat);
    const temperature = params.ambient + power * params.rth;
    return [{ tag: el.tag, name: def.name, power, temperature, wouldShutDown: temperature > THERMAL_SHUTDOWN }];
  });
}
