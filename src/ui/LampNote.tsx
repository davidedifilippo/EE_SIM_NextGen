import React from 'react';
import { Element, SpiceDef } from '../model/types';
import { LAMP_COLD_RATIO, lampRating, lampResistance } from '../realtime/lamp';
import { formatEngineering } from './chartMath';

/** What the lamp is to the circuit, from its rating: a filament that heats and cools. */
export const LampNote: React.FC<{ element: Element; spice: Extract<SpiceDef, { kind: 'lamp' }> }> = ({ element, spice }) => {
  const rating = lampRating(element, spice);
  if (!rating) return <p className="hint">Scrivi una potenza e una tensione maggiori di zero.</p>;
  const hot = lampResistance(rating);
  const cold = hot * LAMP_COLD_RATIO;
  return (
    <p className="hint">
      Alla tensione nominale assorbe {formatEngineering(rating.power / rating.volts, 'A')}: il filamento caldo vale {formatEngineering(hot, 'Ω')}. A freddo vale circa {formatEngineering(cold, 'Ω')}, così all'accensione
      la corrente arriva a circa {formatEngineering(rating.volts / cold, 'A')} e scende in qualche decina di millisecondi mentre il filamento si scalda. A tensione più bassa il filamento è più freddo: a metà tensione
      passa circa il 70% della corrente. Si illumina in proporzione alla potenza; oltre il 110% della tensione nominale compare un avviso. Tempi termici stimati per una lampada piccola.
    </p>
  );
};
