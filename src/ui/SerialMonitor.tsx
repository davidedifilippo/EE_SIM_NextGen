import React, { useEffect, useRef, useState } from 'react';
import { getDevice } from '../library/devices';
import { Circuit } from '../model/types';
import { SerialLog } from './useLiveSimulation';

/** How often the text is looked at: often enough to follow, rarely enough to stay light. */
const REFRESH_MS = 200;

/** What each Arduino writes with Serial.print, as the monitor of the IDE shows it. */
export const SerialMonitor: React.FC<{ circuit: Circuit; serialRef: React.MutableRefObject<SerialLog> }> = ({ circuit, serialRef }) => {
  const boards = circuit.elements.filter((el) => getDevice(el.def)?.spice.kind === 'mcu');
  const [, setVersion] = useState(0);
  const textRef = useRef<HTMLPreElement>(null);
  const [cleared, setCleared] = useState(0);

  useEffect(() => {
    let seen = -1;
    const timer = setInterval(() => {
      if (serialRef.current.version !== seen) {
        seen = serialRef.current.version;
        setVersion(seen);
      }
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [serialRef]);

  // The newest line in view, as in the IDE with autoscroll on
  useEffect(() => {
    const pre = textRef.current;
    if (pre) pre.scrollTop = pre.scrollHeight;
  });

  if (boards.length === 0) return null;
  return (
    <section className="serial-monitor" aria-label="Monitor seriale" data-cleared={cleared}>
      <div className="serial-header">
        <h3>Monitor seriale</h3>
        <button
          onClick={() => {
            serialRef.current.text.clear();
            serialRef.current.version++;
            setCleared((c) => c + 1);
          }}
        >
          Pulisci
        </button>
      </div>
      <pre ref={textRef} className="serial-text">
        {boards.map((el) => {
          const text = serialRef.current.text.get(el.id) ?? '';
          return boards.length > 1 ? `── ${el.tag} ──\n${text}\n` : text;
        })}
      </pre>
      <p className="hint">A 9600 baud, come nell'IDE. Si legge soltanto: per ora la scheda non riceve.</p>
    </section>
  );
};
