import React from 'react';
import { Element } from '../model/types';
import { ssrSpecOf } from '../realtime/ssr';

const comma = (x: number) => String(x).replace('.', ',');

/** How the chosen version of the relay works, from the catalogue, and what the model estimates. */
export const SsrNote: React.FC<{ element: Element }> = ({ element }) => {
  const spec = ssrSpecOf(element.props);
  return (
    <>
      <p className="hint">
        {spec.partNumber}: comando da {comma(spec.pickup)} a {comma(spec.controlMax)} V fra 3 (+) e 4 (−), circa {comma(spec.inputResistance / 1000)} kΩ; sotto {spec.dropout} V il comando si disattiva. Uscita fra 1 e 2 per carichi in
        alternata da 75 a {spec.loadVoltageMax} V rms, fino a {spec.ratedCurrent} A rms (picco non ripetitivo {spec.surgeCurrent} A).{' '}
        {spec.isZeroCross
          ? 'Zero-cross: con il comando attivo il triac si accende solo quando la tensione di uscita passa per lo zero, al più mezzo periodo dopo.'
          : 'Random: con il comando attivo il triac si accende subito, in qualunque punto della sinusoide.'}{' '}
        Tolto il comando, il triac resta acceso fino al prossimo zero della corrente. Da spento passa una piccola corrente attraverso lo snubber. Ingresso e uscita sono isolati: possono avere masse diverse.
      </p>
      <p className="hint">
        Stimati, perché il catalogo non li dà: finestra di zero-cross ±{spec.zeroWindow} V, snubber {spec.snubberR} Ω in serie a {spec.snubberC * 1e9} nF, corrente di mantenimento {spec.holdCurrent * 1000} mA (la corrente
        minima di carico), triac acceso come {comma(spec.onResistance)} Ω (1,6 V alla corrente nominale). Sotto 20 mA il catalogo suggerisce una resistenza in parallelo al carico.
      </p>
    </>
  );
};
