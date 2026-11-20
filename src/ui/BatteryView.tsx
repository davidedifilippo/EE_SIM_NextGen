import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getDevice } from '../library/devices';
import { Circuit } from '../model/types';
import { LiveFrame, LiveLayout } from '../realtime/liveSimulation';
import { BatteryStatus } from '../realtime/lithium';
import { formatEngineering } from './chartMath';

interface Props {
  circuit: Circuit;
  layout: LiveLayout;
  frameRef: React.MutableRefObject<LiveFrame | null>;
}

const REFRESH_MS = 100;
const HALO = { paintOrder: 'stroke', stroke: 'var(--sch-halo)', strokeWidth: 3, strokeLinejoin: 'round' } as const;

/** Above each lithium pack, its charge and the voltage at its poles; once empty, that its protection has opened it. */
export const BatteryView: React.FC<Props> = ({ circuit, layout, frameRef }) => {
  const rootRef = useRef<SVGGElement>(null);
  const packs = useMemo(() => {
    const byId = new Map(circuit.elements.map((el) => [el.id, el]));
    return layout.devices.flatMap((device, index) => {
      const el = byId.get(device.elementId);
      return el && getDevice(el.def)?.spice.kind === 'lithium' ? [{ el, index }] : [];
    });
  }, [circuit, layout]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const refresh = () => {
      const frame = frameRef.current;
      if (!frame || frame.batteries.length !== layout.devices.length) return;
      packs.forEach(({ el, index }) => {
        const status = frame.batteries[index];
        const text = root.querySelector<SVGTextElement>(`[data-battery="${el.id}"]`);
        if (!text || !status) return;
        text.textContent = status.isCut ? 'Batteria scarica' : `${Math.floor(status.charge * 100)}% · ${formatEngineering(Math.abs(frame.deviceVoltage[index]), 'V')}`;
        text.setAttribute('fill', status.isCut || status.charge < 0.1 ? 'var(--sch-alert)' : 'var(--sch-ink)');
      });
    };
    refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(timer);
  }, [frameRef, packs, layout]);

  return (
    <g ref={rootRef} pointerEvents="none" data-testid="battery-view">
      {packs.map(({ el }) => (
        // Above a pack lying down; beside one standing up, whose wires leave from above and below
        <text
          key={el.id}
          data-battery={el.id}
          x={el.rot % 180 === 0 ? el.x : el.x - 22}
          y={el.rot % 180 === 0 ? el.y - 38 : el.y + 4}
          textAnchor={el.rot % 180 === 0 ? 'middle' : 'end'}
          fontSize={11}
          fontWeight={700}
          fill="var(--sch-ink)"
          style={HALO}
        />
      ))}
    </g>
  );
};

/** What a pack is now, for its properties: read from the frames, so it follows the animation. */
export function useBatteryStatus(frameRef: React.MutableRefObject<LiveFrame | null>, index: number): BatteryStatus | null {
  const [status, setStatus] = useState<BatteryStatus | null>(null);
  useEffect(() => {
    const refresh = () => {
      const next = frameRef.current?.batteries[index] ?? null;
      setStatus((before) => (before?.isCut === next?.isCut && Math.abs((before?.charge ?? 0) - (next?.charge ?? 0)) < 0.002 && (before?.autonomy === null) === (next?.autonomy === null) ? before : next));
    };
    refresh();
    const timer = setInterval(refresh, 200);
    return () => clearInterval(timer);
  }, [frameRef, index]);
  return status;
}

/** A time of battery as a person reads it: 2 h 10 min, 4 min 30 s. */
export function batteryTime(seconds: number): string {
  if (seconds >= 3600) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.round((seconds - hours * 3600) / 60);
    return minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`;
  }
  if (seconds >= 60) {
    const minutes = Math.floor(seconds / 60);
    const rest = Math.round(seconds - minutes * 60);
    return rest > 0 ? `${minutes} min ${rest} s` : `${minutes} min`;
  }
  return `${Math.round(seconds)} s`;
}
