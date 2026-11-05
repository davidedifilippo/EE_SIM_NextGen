import React, { useRef, useState } from 'react';
import { Element } from '../model/types';
import { parseIntelHex } from '../realtime/intelHex';
import { CUSTOM_SKETCH } from '../samples/arduino/sketches';

/** Loading a program into the board, and its reset button. */
export const ArduinoProgram: React.FC<{ element: Element; onLoad: (name: string, hex: string) => void; onReset: () => void }> = ({ element, onLoad, onReset }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const isCustom = element.props.sketch === CUSTOM_SKETCH;
  return (
    <div className="arduino-program">
      <div className="button-row">
        <button onClick={() => inputRef.current?.click()}>Carica .hex…</button>
        <button onClick={onReset} title="Riavvia il programma dall'inizio, come il pulsante della scheda">
          Reset
        </button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".hex,text/plain"
        hidden
        aria-label="Carica un programma .hex"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          const text = await file.text();
          if (!parseIntelHex(text)) {
            setError(`${file.name} non è un file .hex per Arduino Uno`);
            return;
          }
          setError('');
          onLoad(file.name, text);
        }}
      />
      {isCustom && element.props.hexName && <p className="hint">Caricato: {String(element.props.hexName)}</p>}
      {error && <p className="hint" style={{ color: 'var(--error-text)' }}>{error}</p>}
      <p className="hint">
        Nell'IDE Arduino scegli la scheda Arduino Uno, poi Sketch → Esporta sketch compilato e carica il file .ino.hex, non quello with_bootloader. Il programma gira solo nell'animazione, alla velocità Automatica in tempo reale.
      </p>
    </div>
  );
};
