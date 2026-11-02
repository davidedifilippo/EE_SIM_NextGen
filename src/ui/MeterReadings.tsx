import React, { useEffect, useMemo, useRef } from 'react';
import { Circuit } from '../model/types';
import { getDevice } from '../library/devices';
import { LiveFrame, LiveLayout } from '../realtime/liveSimulation';
import { METER_MODES, meterValue } from '../realtime/meter';
import { formatEngineering } from './chartMath';

interface Props {
  circuit: Circuit;
  layout: LiveLayout;
  frameRef: React.MutableRefObject<LiveFrame | null>;
}

const REFRESH_MS = 200;

/** The display of each multimeter. Updates the text directly, as LiveOverlay does. */
export const MeterReadings: React.FC<Props> = ({ circuit, layout, frameRef }) => {
  const rootRef = useRef<SVGGElement>(null);
  const meters = useMemo(() => {
    const byId = new Map(circuit.elements.map((el) => [el.id, el]));
    return layout.devices.flatMap((device, index) => {
      const el = byId.get(device.elementId)!;
      const mode = METER_MODES.find((m) => m.value === el.props.mode);
      return getDevice(el.def)?.spice.kind === 'meter' && mode ? [{ el, index, mode }] : [];
    });
  }, [circuit, layout]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const texts = [...root.querySelectorAll<SVGTextElement>('[data-meter="value"]')];
    const refresh = () => {
      const frame = frameRef.current;
      if (!frame || frame.meterMean.length !== layout.devices.length) return;
      meters.forEach(({ index, mode }, i) => {
        const mean = frame.meterMean[index];
        texts[i].textContent = Number.isNaN(mean) ? '—' : formatEngineering(meterValue(mode.value, { mean, ac: frame.meterAc[index] }), mode.unit);
      });
    };
    refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(timer);
  }, [layout, frameRef, meters]);

  return (
    <g ref={rootRef} pointerEvents="none" textAnchor="middle" fill="#0f172a" style={{ fontVariantNumeric: 'tabular-nums' }} data-testid="meter-readings">
      {meters.map(({ el, mode }) => (
        <React.Fragment key={el.id}>
          <text data-meter="value" x={el.x} y={el.y + 1} fontSize={11} fontWeight={700}>
            —
          </text>
          <text x={el.x} y={el.y + 15} fontSize={10} fill="#475569">
            {mode.symbol}
          </text>
        </React.Fragment>
      ))}
    </g>
  );
};
