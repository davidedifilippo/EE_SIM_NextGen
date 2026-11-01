import React, { useEffect, useMemo, useRef, useState } from 'react';
import { TranResult } from '../engine/ngspice';
import { formatFixed, formatSi, niceTicks, nearestIndex, pickTimeUnit, downsampleMinMax } from './chartMath';

export interface Series {
  node: string;
  label: string;
}

interface Props {
  result: TranResult;
  series: Series[];
}

const HEIGHT = 260;
const MARGIN = { top: 12, right: 44, bottom: 34, left: 50 };
const MAX_SERIES = 8;
const LABEL_GAP = 13;

export const TransientChart: React.FC<Props> = ({ result, series }) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(entry.contentRect.width, 240)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const { time, voltages } = result;
  const plotted = series.slice(0, MAX_SERIES).map((s, i) => ({ ...s, slot: i + 1, values: voltages.get(s.node) ?? [] }));
  const visible = plotted.filter((s) => !hidden.has(s.node));

  const plotW = width - MARGIN.left - MARGIN.right;
  const plotH = HEIGHT - MARGIN.top - MARGIN.bottom;
  const tMin = time[0] ?? 0;
  const tMax = time[time.length - 1] ?? 1;
  const unit = pickTimeUnit(tMax);

  const yTicks = useMemo(() => {
    let [lo, hi] = [Infinity, -Infinity];
    for (const s of visible) {
      for (const v of s.values) {
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    return Number.isFinite(lo) ? niceTicks(lo, hi, 6) : [0, 1];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, hidden, series]);
  const xTicks = useMemo(() => niceTicks(tMin, tMax, Math.max(3, Math.floor(plotW / 90))), [tMin, tMax, plotW]);

  const yMin = yTicks[0];
  const yMax = yTicks[yTicks.length - 1];
  const sx = (t: number) => MARGIN.left + ((t - tMin) / (tMax - tMin || 1)) * plotW;
  const sy = (v: number) => MARGIN.top + (1 - (v - yMin) / (yMax - yMin || 1)) * plotH;

  const paths = useMemo(
    () =>
      visible.map((s) => {
        const idx = downsampleMinMax(time, s.values, plotW);
        return idx.map((i, k) => `${k === 0 ? 'M' : 'L'}${sx(time[i]).toFixed(1)} ${sy(s.values[i]).toFixed(1)}`).join('');
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [result, hidden, series, plotW, yMin, yMax],
  );

  // Direct labels at the line end, pushed apart so they never overlap
  const endLabels = useMemo(() => {
    if (visible.length > 4) return [];
    const labels = visible
      .map((s) => ({ node: s.node, y: sy(s.values[s.values.length - 1] ?? 0) }))
      .sort((a, b) => a.y - b.y);
    for (let i = 1; i < labels.length; i++) {
      labels[i].y = Math.max(labels[i].y, labels[i - 1].y + LABEL_GAP);
    }
    return labels;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, hidden, series, yMin, yMax]);

  const handleMove = (e: React.PointerEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const t = tMin + ((e.clientX - rect.left) / rect.width) * (tMax - tMin);
    setHoverIdx(nearestIndex(time, t));
  };

  const hoverX = hoverIdx !== null ? sx(time[hoverIdx]) : 0;
  const tableRows = useMemo(() => {
    const step = Math.max(1, Math.floor(time.length / 25));
    return time.flatMap((_, i) => (i % step === 0 ? [i] : []));
  }, [time]);

  const toggle = (node: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(node)) next.delete(node);
      else next.add(node);
      return next;
    });

  return (
    <div className="viz-root" ref={rootRef}>
      <div className="viz-header">
        <strong>Tensioni dei nodi rispetto a massa</strong>
        <button className="link-button" onClick={() => setShowTable((v) => !v)}>
          {showTable ? 'Mostra grafico' : 'Mostra tabella'}
        </button>
      </div>

      <div className="viz-legend">
        {plotted.map((s) => (
          <button
            key={s.node}
            className={`viz-legend-item ${hidden.has(s.node) ? 'off' : ''}`}
            aria-pressed={!hidden.has(s.node)}
            onClick={() => toggle(s.node)}
          >
            <span className="viz-swatch" style={{ background: `var(--series-${s.slot})` }} />
            {s.label}
          </button>
        ))}
        {series.length > MAX_SERIES && <span className="viz-note">Altri {series.length - MAX_SERIES} nodi non mostrati</span>}
      </div>

      {showTable ? (
        <div className="viz-table-wrap">
          <table className="viz-table">
            <thead>
              <tr>
                <th>Tempo ({unit.symbol})</th>
                {plotted.map((s) => (
                  <th key={s.node}>V({s.node}) [V]</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tableRows.map((i) => (
                <tr key={i}>
                  <td>{formatFixed(time[i] / unit.factor, 2)}</td>
                  {plotted.map((s) => (
                    <td key={s.node}>{formatFixed(s.values[i] ?? 0, 3)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="viz-plot">
          <svg width={width} height={HEIGHT} role="img" aria-label="Grafico del transitorio delle tensioni dei nodi">
            {yTicks.map((v) => (
              <g key={v}>
                <line x1={MARGIN.left} x2={MARGIN.left + plotW} y1={sy(v)} y2={sy(v)} className={v === 0 ? 'viz-zero' : 'viz-grid'} />
                <text x={MARGIN.left - 8} y={sy(v) + 4} textAnchor="end" className="viz-tick">
                  {formatSi(v)}
                </text>
              </g>
            ))}
            {xTicks.map((t) => (
              <text key={t} x={sx(t)} y={MARGIN.top + plotH + 16} textAnchor="middle" className="viz-tick">
                {formatSi(t / unit.factor)}
              </text>
            ))}
            <text x={MARGIN.left + plotW / 2} y={HEIGHT - 4} textAnchor="middle" className="viz-tick">
              Tempo ({unit.symbol})
            </text>
            <text x={12} y={MARGIN.top + plotH / 2} textAnchor="middle" className="viz-tick" transform={`rotate(-90 12 ${MARGIN.top + plotH / 2})`}>
              Tensione (V)
            </text>

            {visible.map((s, i) => (
              <path key={s.node} d={paths[i]} fill="none" stroke={`var(--series-${s.slot})`} strokeWidth={2} strokeLinejoin="round" />
            ))}
            {endLabels.map((l) => (
              <text key={l.node} x={MARGIN.left + plotW + 6} y={l.y + 4} className="viz-direct">
                {l.node}
              </text>
            ))}

            {hoverIdx !== null && (
              <g pointerEvents="none">
                <line x1={hoverX} x2={hoverX} y1={MARGIN.top} y2={MARGIN.top + plotH} className="viz-crosshair" />
                {visible.map((s) => (
                  <circle key={s.node} cx={hoverX} cy={sy(s.values[hoverIdx])} r={4} fill={`var(--series-${s.slot})`} stroke="var(--surface-1)" strokeWidth={2} />
                ))}
              </g>
            )}
            {/* Hit target larger than the marks */}
            <rect
              x={MARGIN.left}
              y={MARGIN.top}
              width={plotW}
              height={plotH}
              fill="transparent"
              style={{ touchAction: 'pan-y' }}
              onPointerMove={handleMove}
              onPointerDown={handleMove}
              onPointerLeave={() => setHoverIdx(null)}
            />
          </svg>

          {hoverIdx !== null && (
            <div
              className="viz-tooltip"
              style={hoverX > width / 2 ? { right: width - hoverX + 10 } : { left: hoverX + 10 }}
            >
              <div className="viz-tooltip-title">
                {formatFixed(time[hoverIdx] / unit.factor, 2)} {unit.symbol}
              </div>
              {visible.map((s) => (
                <div key={s.node} className="viz-tooltip-row">
                  <span className="viz-swatch" style={{ background: `var(--series-${s.slot})` }} />
                  <span>{s.node}</span>
                  <strong>{formatFixed(s.values[hoverIdx] ?? 0, 3)} V</strong>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
