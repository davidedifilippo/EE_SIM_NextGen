import React, { useEffect, useMemo, useRef } from 'react';
import { getDevice } from '../library/devices';
import { Circuit } from '../model/types';
import { LiveFrame, LiveLayout } from '../realtime/liveSimulation';
import { localToWorld } from '../utils/geometry';

interface Props {
  circuit: Circuit;
  layout: LiveLayout;
  frameRef: React.MutableRefObject<LiveFrame | null>;
}

/** Above the name of the part. */
const WARNING_AT = { x: 0, y: -68 };
const HALO = { paintOrder: 'stroke', stroke: 'var(--sch-halo)', strokeWidth: 3, strokeLinejoin: 'round' } as const;
const REFRESH_MS = 200;

/** What each optocoupler takes beyond its absolute maxima, in red above it. */
export const OptoView: React.FC<Props> = ({ circuit, layout, frameRef }) => {
  const rootRef = useRef<SVGGElement>(null);
  const optos = useMemo(() => {
    const byId = new Map(circuit.elements.map((el) => [el.id, el]));
    return layout.devices.flatMap((device, index) => {
      // The parts inside a block have no drawing of their own
      const el = byId.get(device.elementId);
      if (!el) return [];
      return getDevice(el.def)?.spice.kind === 'opto' ? [{ id: el.id, index, at: localToWorld(el.x, el.y, WARNING_AT, el.rot, el.flip) }] : [];
    });
  }, [circuit, layout]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const texts = [...root.querySelectorAll<SVGTextElement>('text')];
    const refresh = () => {
      const frame = frameRef.current;
      if (!frame) return;
      optos.forEach(({ index }, i) => {
        if (texts[i]) texts[i].textContent = frame.optos[index]?.join(', ') ?? '';
      });
    };
    refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(timer);
  }, [frameRef, optos]);

  return (
    <g ref={rootRef} pointerEvents="none" data-testid="opto-view">
      {optos.map(({ id, at }) => (
        <text key={id} x={at.x} y={at.y} textAnchor="middle" fontSize={11} fontWeight={700} fill="var(--sch-alert)" style={HALO} />
      ))}
    </g>
  );
};
