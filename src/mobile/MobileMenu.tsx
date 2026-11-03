import React from 'react';
import { downloadCircuit } from '../storage/circuitFile';
import { ExamplesSelect, SpeedSelect, ThemeSelect, ValuesToggle } from '../workbench/parts';
import { Workbench } from '../workbench/useWorkbench';

interface Props {
  wb: Workbench;
  onFullLayout: () => void;
  onClose: () => void;
}

/** What the toolbar holds on a large screen, in one list under ⋮. */
export const MobileMenu: React.FC<Props> = ({ wb, onFullLayout, onClose }) => {
  const act = (action: () => void) => () => {
    onClose();
    action();
  };
  return (
    <div className="dialog-backdrop mobile-menu-backdrop" onPointerDown={onClose}>
      <div className="mobile-menu" role="menu" onPointerDown={(e) => e.stopPropagation()}>
        <button onClick={act(wb.newCircuit)}>Nuovo</button>
        <button onClick={act(() => wb.fileInputRef.current?.click())}>Apri…</button>
        <ExamplesSelect wb={wb} onOpened={onClose} />
        <button onClick={act(() => downloadCircuit(wb.forSaving))}>Salva</button>
        <button onClick={act(() => wb.setIsSharing(true))}>Condividi</button>
        <hr />
        <SpeedSelect wb={wb} />
        <ValuesToggle wb={wb} />
        <ThemeSelect wb={wb} />
        <hr />
        <button onClick={act(onFullLayout)}>Interfaccia completa</button>
      </div>
    </div>
  );
};
