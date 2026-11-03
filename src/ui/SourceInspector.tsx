import React from 'react';
import { SOURCE_GLYPHS } from '../library/devices';
import { Element } from '../model/types';
import { dutyCycle, MAX_DUTY, MIN_DUTY, SourceShape, sourceShape, sourceSpec } from '../netlist/source';
import { parseSpiceValue } from '../netlist/values';
import { waveformStats } from '../realtime/waveform';
import { formatEngineering } from './chartMath';
import { RangeSlider, ValueSlider } from './ValueSlider';

const SHAPES: { shape: SourceShape; label: string }[] = [
  { shape: 'sin', label: 'Sinusoide' },
  { shape: 'square', label: 'Onda quadra' },
  { shape: 'custom', label: 'Avanzato' },
];

interface Props {
  props: Element['props'];
  /** A DC supply or a battery: only its voltage to set. */
  isDcOnly?: boolean;
  onChange: (props: Element['props'], record?: boolean) => void;
}

/** Signal generator settings, in terms of the signal and not of its SPICE syntax. */
export const SourceInspector: React.FC<Props> = ({ props, isDcOnly = false, onChange }) => {
  const shape = sourceShape(props);
  const set = (key: string, value: string, record = true) => onChange({ ...props, [key]: value }, record);

  const choose = (next: SourceShape) => {
    // An advanced source starts from the current signal, but never overwrites a string already written
    const spec = next === 'custom' && !String(props.spec ?? '').trim() ? sourceSpec(props) ?? '' : props.spec ?? '';
    onChange({ ...props, shape: next, spec });
  };

  const field = (key: string, label: string, options: { slider?: boolean; optional?: boolean } = {}) => {
    const value = String(props[key] ?? '');
    const valid = parseSpiceValue(value) !== null || (options.optional && !value.trim());
    return (
      <label>
        {label}
        <input value={value} aria-invalid={!valid} onChange={(e) => set(key, e.target.value)} />
        {options.slider && <ValueSlider value={value} label={label} onChange={(next, record) => set(key, next, record)} />}
      </label>
    );
  };

  const spec = sourceSpec(props);
  const stats = spec ? waveformStats(spec) : null;
  // Continuous voltage has its own parts now: a generator from an older circuit can still leave it
  const shapes = shape === 'dc' ? [{ shape, label: 'Continua' }, ...SHAPES] : SHAPES;

  return (
    <>
      {!isDcOnly && <div className="shape-picker">
        <span id="shape-picker-label">Tipo di segnale</span>
        <div role="group" aria-labelledby="shape-picker-label">
          {shapes.map((s) => (
            <button key={s.shape} className={shape === s.shape ? 'active' : ''} aria-pressed={shape === s.shape} aria-label={s.label} title={s.label} onClick={() => choose(s.shape)}>
              <svg viewBox="-9 -9 18 18" width={22} height={22} aria-hidden="true">
                <path d={SOURCE_GLYPHS[s.shape]} fill="none" stroke="currentColor" strokeWidth={1.5} />
              </svg>
            </button>
          ))}
        </div>
      </div>}

      {shape === 'dc' && field('amplitude', 'Tensione (V)', { slider: true })}

      {(shape === 'sin' || shape === 'square') && (
        <>
          {field('amplitude', 'Valore massimo (V)', { slider: true })}
          {shape === 'sin' && (
            <label>
              Valore efficace
              <input value={stats ? formatEngineering(stats.rms, 'V') : '—'} readOnly tabIndex={-1} />
            </label>
          )}
          {field('offset', 'Offset (V)', { optional: true })}
          {field('frequency', 'Frequenza (Hz)', { slider: true })}
          {shape === 'sin' && field('phase', 'Fase iniziale (°)', { optional: true })}
          {shape === 'square' && (
            <label>
              Duty cycle (%)
              <input value={String(props.duty ?? '')} aria-invalid={dutyCycle(props) === null} onChange={(e) => set('duty', e.target.value)} />
              <RangeSlider value={String(props.duty ?? '')} label="Duty cycle" min={MIN_DUTY} max={MAX_DUTY} onChange={(next, record) => set('duty', next, record)} />
            </label>
          )}
        </>
      )}

      {shape === 'custom' && (
        <>
          <label>
            Stringa ngspice
            <input value={String(props.spec ?? '')} aria-invalid={!spec} onChange={(e) => set('spec', e.target.value)} />
          </label>
          {stats && (
            <label>
              Valore efficace
              <input value={formatEngineering(stats.rms, 'V')} readOnly tabIndex={-1} />
            </label>
          )}
        </>
      )}

      {field('rint', 'Resistenza interna (Ω), 0 se ideale', { optional: true })}
    </>
  );
};
