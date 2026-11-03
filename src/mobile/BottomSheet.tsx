import React, { useRef } from 'react';

interface Props {
  title: string;
  /** Over the whole screen, as the results in landscape. */
  isFull?: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

/** How far the handle must be pulled down to close the panel. */
const CLOSE_PULL = 60;

/** A panel rising from the bottom, over the lower part of the schematic. Pulling its handle down closes it. */
export const BottomSheet: React.FC<Props> = ({ title, isFull = false, onClose, children }) => {
  const pullRef = useRef<number | null>(null);
  return (
    <section className={isFull ? 'bottom-sheet full' : 'bottom-sheet'} aria-label={title}>
      <header
        className="sheet-handle"
        onPointerDown={(e) => {
          pullRef.current = e.clientY;
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerUp={(e) => {
          if (pullRef.current !== null && e.clientY - pullRef.current > CLOSE_PULL) onClose();
          pullRef.current = null;
        }}
      >
        <span className="sheet-grip" aria-hidden="true" />
        <h2>{title}</h2>
        <button aria-label={`Chiudi ${title}`} onPointerDown={(e) => e.stopPropagation()} onClick={onClose}>
          ×
        </button>
      </header>
      <div className="sheet-body">{children}</div>
    </section>
  );
};
