import React, { useEffect, useMemo, useRef } from 'react';
import { getDevice } from '../library/devices';
import { Circuit } from '../model/types';
import { LiveFrame, LiveLayout } from '../realtime/liveSimulation';

interface Props {
  circuit: Circuit;
  layout: LiveLayout;
  frameRef: React.MutableRefObject<LiveFrame | null>;
}

const REFRESH_MS = 200;

const volts = (v: number) => String(v).replace('.', ',');

/** The range the supply of a sensor must stay in, as its datasheet gives it. */
function supplyWarning(el: Circuit['elements'][number]): string {
  const spice = getDevice(el.def)?.spice;
  const sensor = spice?.kind === 'regulator' ? spice.sensor : undefined;
  return sensor ? `Alimentazione fuori campo (${volts(sensor.vMin)}–${volts(sensor.vMax)} V)` : '';
}

/** A protection at work, written next to the part. Updates the text directly, as LiveOverlay does. */
export const RegulatorStatus: React.FC<Props> = ({ circuit, layout, frameRef }) => {
  const rootRef = useRef<SVGGElement>(null);
  const parts = useMemo(() => {
    const byId = new Map(circuit.elements.map((el) => [el.id, el]));
    return layout.devices.flatMap((device, index) => {
      // The parts inside a block have no drawing of their own
      const el = byId.get(device.elementId);
      if (!el) return [];
      return getDevice(el.def)?.spice.kind === 'regulator' ? [{ el, index }] : [];
    });
  }, [circuit, layout]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const texts = [...root.querySelectorAll<SVGTextElement>('text')];
    const refresh = () => {
      const frame = frameRef.current;
      if (!frame) return;
      parts.forEach(({ el, index }, i) => {
        const region = frame.regulators[index]?.region;
        texts[i].textContent = region === 'thermal' ? 'Protezione termica' : region === 'limit' ? 'Limite di corrente' : region === 'damaged' ? 'Danneggiato' : region === 'supply' ? supplyWarning(el) : '';
      });
    };
    refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(timer);
  }, [frameRef, parts]);

  return (
    <g ref={rootRef} pointerEvents="none" textAnchor="middle" fontSize={11} fontWeight={700} fill="var(--sch-alert)" style={{ paintOrder: 'stroke', stroke: 'var(--sch-halo)', strokeWidth: 3, strokeLinejoin: 'round' }} data-testid="regulator-status">
      {parts.map(({ el }) => (
        <text key={el.id} x={el.x} y={el.y - 38} />
      ))}
    </g>
  );
};
