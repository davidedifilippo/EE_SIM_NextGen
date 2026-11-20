import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getDevice } from '../library/devices';
import { Circuit, Element } from '../model/types';
import { LiveFrame, LiveLayout } from '../realtime/liveSimulation';
import { FuseStatus } from '../realtime/fuse';
import { localToWorld } from '../utils/geometry';

interface Props {
  circuit: Circuit;
  layout: LiveLayout;
  frameRef: React.MutableRefObject<LiveFrame | null>;
}

const REFRESH_MS = 100;
const HALO = { paintOrder: 'stroke', stroke: 'var(--sch-halo)', strokeWidth: 3, strokeLinejoin: 'round' } as const;
const OVER = '#dc2626';

/** The corners of a part of the drawing, from its own coordinates to the sheet. */
const corners = (el: Element, x1: number, y1: number, x2: number, y2: number) =>
  [
    [x1, y1],
    [x2, y1],
    [x2, y2],
    [x1, y2],
  ]
    .map(([x, y]) => localToWorld(el.x, el.y, { x, y }, el.rot, el.flip))
    .map((p) => `${p.x},${p.y}`)
    .join(' ');

/**
 * Each fuse as it is now: red beyond its rated current, while it warms; once blown, its wire broken in the
 * middle and a warning above it.
 */
export const FuseView: React.FC<Props> = ({ circuit, layout, frameRef }) => {
  const rootRef = useRef<SVGGElement>(null);
  const fuses = useMemo(() => {
    const byId = new Map(circuit.elements.map((el) => [el.id, el]));
    return layout.devices.flatMap((device, index) => {
      const el = byId.get(device.elementId);
      return el && getDevice(el.def)?.spice.kind === 'fuse' ? [{ el, index }] : [];
    });
  }, [circuit, layout]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const refresh = () => {
      const frame = frameRef.current;
      if (!frame || frame.fuses.length !== layout.devices.length) return;
      fuses.forEach(({ el, index }) => {
        const status = frame.fuses[index];
        root.querySelector(`[data-fuse-over="${el.id}"]`)?.setAttribute('visibility', status?.isOver ? 'visible' : 'hidden');
        root.querySelectorAll(`[data-fuse-blown="${el.id}"]`).forEach((node) => node.setAttribute('visibility', status?.isBlown ? 'visible' : 'hidden'));
      });
    };
    refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(timer);
  }, [frameRef, fuses, layout]);

  return (
    <g ref={rootRef} pointerEvents="none" data-testid="fuse-view">
      {fuses.map(({ el }) => (
        <g key={el.id}>
          <polygon data-fuse-over={el.id} points={corners(el, -20, -7, 20, 7)} fill={OVER} opacity={0.6} visibility="hidden" />
          {/* The wire melted in the middle */}
          <polygon data-fuse-blown={el.id} points={corners(el, -7, -3, 7, 3)} fill="var(--sch-part)" visibility="hidden" />
          <text data-fuse-blown={el.id} x={el.x} y={el.y - 38} textAnchor="middle" fontSize={11} fontWeight={700} fill="var(--sch-alert)" style={HALO} visibility="hidden">
            Fusibile interrotto
          </text>
        </g>
      ))}
    </g>
  );
};

/** What a fuse is now, for its properties: read from the frames, so it follows the animation. */
export function useFuseStatus(frameRef: React.MutableRefObject<LiveFrame | null>, index: number): FuseStatus | null {
  const [status, setStatus] = useState<FuseStatus | null>(null);
  useEffect(() => {
    const refresh = () => {
      const next = frameRef.current?.fuses[index] ?? null;
      setStatus((before) => (before?.isBlown === next?.isBlown && before?.isOver === next?.isOver && Math.abs((before?.heat ?? 0) - (next?.heat ?? 0)) < 0.01 ? before : next));
    };
    refresh();
    const timer = setInterval(refresh, 200);
    return () => clearInterval(timer);
  }, [frameRef, index]);
  return status;
}
