import React, { useRef, useState } from 'react';
import { formatSpiceValue, parseSpiceValue } from '../netlist/values';

interface Props {
  value: string;
  label: string;
  /** record is true only for the first change of a drag, so one drag is one undo step. */
  onChange: (value: string, record: boolean) => void;
}

const STEPS = 1000;
/** The slider spans from a tenth to ten times the value at the start of the drag. */
const DECADES = 1;

/** Linear slider between two limits, for values that have a fixed range. */
export const RangeSlider: React.FC<Props & { min: number; max: number }> = ({ value, label, onChange, min, max }) => {
  const parsed = parseSpiceValue(value);
  const hasRecorded = useRef(false);

  return (
    <input
      type="range"
      className="value-slider"
      aria-label={`Regola ${label}`}
      min={min}
      max={max}
      step={1}
      value={Math.max(min, Math.min(max, parsed ?? (min + max) / 2))}
      onPointerDown={() => {
        hasRecorded.current = false;
      }}
      onChange={(e) => {
        onChange(e.target.value, !hasRecorded.current);
        hasRecorded.current = true;
      }}
    />
  );
};

/** Logarithmic slider, usable with a finger, for changing a value while the circuit runs. */
export const ValueSlider: React.FC<Props> = ({ value, label, onChange }) => {
  const parsed = parseSpiceValue(value);
  const [dragBase, setDragBase] = useState<number | null>(null);
  const hasRecorded = useRef(false);
  if (parsed === null || parsed <= 0) return null;

  const base = dragBase ?? parsed;
  const position = ((Math.log10(parsed / base) + DECADES) / (2 * DECADES)) * STEPS;

  return (
    <input
      type="range"
      className="value-slider"
      aria-label={`Regola ${label}`}
      min={0}
      max={STEPS}
      value={Math.round(position)}
      onPointerDown={() => {
        setDragBase(parsed);
        hasRecorded.current = false;
      }}
      onPointerUp={() => setDragBase(null)}
      onPointerCancel={() => setDragBase(null)}
      onChange={(e) => {
        const exponent = (Number(e.target.value) / STEPS) * 2 * DECADES - DECADES;
        onChange(formatSpiceValue(base * 10 ** exponent), !hasRecorded.current);
        hasRecorded.current = true;
      }}
    />
  );
};
