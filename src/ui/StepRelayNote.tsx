import React from 'react';
import { Element, SpiceDef } from '../model/types';
import { stepRelaySpec } from '../realtime/stepRelay';

const SEQUENCE_TEXT = { '27.01': 'aperto, chiuso', '27.05': 'tutti aperti, solo 4, solo 2, tutti e due', '27.06': 'tutti aperti, solo 4, tutti e due' } as const;

/** How the chosen version works, from the datasheet of the series 27, and what the model estimates. */
export const StepRelayNote: React.FC<{ element: Element; spice: Extract<SpiceDef, { kind: 'steprelay' }> }> = ({ element, spice }) => {
  const spec = stepRelaySpec(spice.version, element.props[spice.coilProp]);
  return (
    <>
      <p className="hint">
        Finder {spec.version}.8.{spec.volts}: a ogni impulso sulla bobina i contatti passano alla sequenza successiva ({SEQUENCE_TEXT[spec.version]}). A1/1/3 è comune alla bobina e ai contatti: la fase su A1, il pulsante fra A2
        e il neutro, le lampade fra {spice.c4 ? '2 o 4' : '2'} e il neutro. Bobina {spec.volts} V AC, {spec.coilResistance} Ω, funziona da {String(Math.round(spec.volts * 0.8))} a {spec.vMax} V; contatti da 10 A (20 A di picco).
        Impulso fra 0,1 s e 1 ora.
      </p>
      <p className="hint">
        Stimati: rilascio sotto il 15% della tensione nominale, e l'ancora che resta attratta fra un picco e l'altro della corrente alternata. All'inserzione la corrente della bobina può superare per un attimo quella di
        regime, e il relè scattare anche un po' sotto il minimo.
      </p>
    </>
  );
};
