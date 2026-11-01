import React from 'react';

export interface PlotCurve {
  key: string;
  slot: number;
  values: number[];
  /** Written at the end of the line, when there is room for it. */
  endLabel?: string;
}

interface Props {
  width: number;
  xs: number[];
  /** Where a value of x falls along the axis, from 0 to 1. */
  xFraction: (x: number) => number;
  /** The index of xs nearest to a place along the axis. */
  indexAt: (fraction: number) => number;
  xTicks: { value: number; label: string }[];
  curves: PlotCurve[];
  yTicks: number[];
  yLabel: string;
  formatY: (v: number) => string;
  hoverIndex: number | null;
  onHover: (index: number | null) => void;
  showEndLabels: boolean;
}

const PLOT_HEIGHT = 170;
export const PLOT_MARGIN = { top: 10, right: 44, bottom: 24, left: 50 };
const LABEL_GAP = 13;

/** One plot of a curve against something other than time, with grid, end labels and crosshair. */
export const XYPlot: React.FC<Props> = ({ width, xs, xFraction, indexAt, xTicks, curves, yTicks, yLabel, formatY, hoverIndex, onHover, showEndLabels }) => {
  const plotW = Math.max(width - PLOT_MARGIN.left - PLOT_MARGIN.right, 60);
  const plotH = PLOT_HEIGHT - PLOT_MARGIN.top - PLOT_MARGIN.bottom;
  const sx = (x: number) => PLOT_MARGIN.left + xFraction(x) * plotW;
  const [yMin, yMax] = [yTicks[0], yTicks[yTicks.length - 1]];
  const sy = (v: number) => PLOT_MARGIN.top + (1 - (v - yMin) / (yMax - yMin || 1)) * plotH;

  const labels = curves.map((c) => ({ key: c.key, text: c.endLabel ?? '', y: sy(c.values[c.values.length - 1]) })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) labels[i].y = Math.max(labels[i].y, labels[i - 1].y + LABEL_GAP);

  const handleMove = (e: React.PointerEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    onHover(indexAt((e.clientX - rect.left) / rect.width));
  };

  return (
    <svg width={width} height={PLOT_HEIGHT} role="img" aria-label={yLabel}>
      {yTicks.map((v) => (
        <g key={v}>
          <line x1={PLOT_MARGIN.left} x2={PLOT_MARGIN.left + plotW} y1={sy(v)} y2={sy(v)} className={v === 0 ? 'viz-zero' : 'viz-grid'} />
          <text x={PLOT_MARGIN.left - 6} y={sy(v) + 4} textAnchor="end" className="viz-tick">
            {formatY(v)}
          </text>
        </g>
      ))}
      {xTicks.map(({ value, label }) => (
        <g key={value}>
          <line x1={sx(value)} x2={sx(value)} y1={PLOT_MARGIN.top} y2={PLOT_MARGIN.top + plotH} className="viz-grid" />
          <text x={sx(value)} y={PLOT_HEIGHT - 8} textAnchor="middle" className="viz-tick">
            {label}
          </text>
        </g>
      ))}
      {curves.map((c) => (
        <path
          key={c.key}
          d={c.values.map((v, i) => `${i === 0 ? 'M' : 'L'}${sx(xs[i]).toFixed(1)} ${sy(v).toFixed(1)}`).join('')}
          fill="none"
          stroke={`var(--series-${c.slot})`}
          strokeWidth={2}
          strokeLinejoin="round"
        />
      ))}
      {showEndLabels &&
        labels.map((l) => (
          <text key={l.key} x={PLOT_MARGIN.left + plotW + 6} y={l.y + 4} className="viz-direct">
            {l.text}
          </text>
        ))}
      {hoverIndex !== null && (
        <g pointerEvents="none">
          <line x1={sx(xs[hoverIndex])} x2={sx(xs[hoverIndex])} y1={PLOT_MARGIN.top} y2={PLOT_MARGIN.top + plotH} className="viz-crosshair" />
          {curves.map((c) => (
            <circle key={c.key} cx={sx(xs[hoverIndex])} cy={sy(c.values[hoverIndex])} r={4} fill={`var(--series-${c.slot})`} stroke="var(--surface-1)" strokeWidth={2} />
          ))}
        </g>
      )}
      <rect
        x={PLOT_MARGIN.left}
        y={PLOT_MARGIN.top}
        width={plotW}
        height={plotH}
        fill="transparent"
        style={{ touchAction: 'pan-y' }}
        onPointerMove={handleMove}
        onPointerDown={handleMove}
        onPointerLeave={() => onHover(null)}
      />
    </svg>
  );
};
