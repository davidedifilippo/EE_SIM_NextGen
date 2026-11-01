import React, { useEffect, useMemo, useRef } from 'react';
import { Circuit } from '../model/types';
import { LiveFrame, LiveLayout } from '../realtime/liveSimulation';
import { formatEngineering } from './chartMath';
import { currentLabels, currentText, nodeLabels } from './dcLabels';

interface Props {
  circuit: Circuit;
  layout: LiveLayout;
  frameRef: React.MutableRefObject<LiveFrame | null>;
}

const REFRESH_MS = 200;
const VOLTAGE_COLOR = '#1d4ed8';
const CURRENT_COLOR = '#c2410c';

/** Node voltages and component currents written on the schematic. Updates the text directly, as LiveOverlay does. */
export const DcValues: React.FC<Props> = ({ circuit, layout, frameRef }) => {
  const rootRef = useRef<SVGGElement>(null);
  const nodes = useMemo(() => nodeLabels(layout), [layout]);
  const currents = useMemo(() => currentLabels(circuit, layout), [circuit, layout]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const nodeTexts = [...root.querySelectorAll<SVGTextElement>('[data-dc="node"]')];
    const currentTexts = [...root.querySelectorAll<SVGTextElement>('[data-dc="current"]')];

    const refresh = () => {
      const frame = frameRef.current;
      if (!frame || frame.edgeVoltage.length !== layout.edgeNode.length || frame.dotCurrent.length !== layout.dots.length) return;
      nodes.forEach((label, i) => {
        nodeTexts[i].textContent = formatEngineering(frame.edgeVoltage[label.edge], 'V');
      });
      currents.forEach((label, i) => {
        currentTexts[i].textContent = currentText(label.name, layout.dots[label.dot], frame.dotCurrent[label.dot]);
      });
    };
    refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(timer);
  }, [layout, frameRef, nodes, currents]);

  const textStyle: React.CSSProperties = { paintOrder: 'stroke', stroke: '#ffffff', strokeWidth: 3, strokeLinejoin: 'round', fontVariantNumeric: 'tabular-nums' };

  return (
    <g ref={rootRef} pointerEvents="none" fontSize={11} fontWeight={600} style={textStyle} data-testid="dc-values">
      {nodes.map((label) => (
        <text key={label.edge} data-dc="node" x={label.x} y={label.y} textAnchor={label.anchor} fill={VOLTAGE_COLOR} />
      ))}
      {currents.map((label) => (
        <text key={label.dot} data-dc="current" x={label.x} y={label.y} textAnchor={label.anchor} fill={CURRENT_COLOR} />
      ))}
    </g>
  );
};
