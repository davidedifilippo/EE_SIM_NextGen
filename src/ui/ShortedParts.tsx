import React, { useMemo } from 'react';
import { Circuit } from '../model/types';
import { shortedParts } from '../editor/shorted';

const HALO = { paintOrder: 'stroke', stroke: 'var(--sch-halo)', strokeWidth: 3, strokeLinejoin: 'round' } as const;

/** Above each part whose two terminals a wire joins, in red: it is short-circuited, and does nothing. */
export const ShortedParts: React.FC<{ circuit: Circuit }> = ({ circuit }) => {
  const shorted = useMemo(() => {
    const ids = new Set(shortedParts(circuit));
    return circuit.elements.filter((el) => ids.has(el.id));
  }, [circuit]);
  return (
    <g pointerEvents="none" data-testid="shorted-parts">
      {shorted.map((el) => (
        <text
          key={el.id}
          x={el.rot % 180 === 0 ? el.x : el.x - 22}
          y={el.rot % 180 === 0 ? el.y - 38 : el.y + 4}
          textAnchor={el.rot % 180 === 0 ? 'middle' : 'end'}
          fontSize={11}
          fontWeight={700}
          fill="var(--sch-alert)"
          style={HALO}
        >
          Cortocircuitato da un filo
        </text>
      ))}
    </g>
  );
};
