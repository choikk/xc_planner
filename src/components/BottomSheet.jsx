import { useEffect, useRef, useState } from 'react';

const order = ['collapsed', 'half', 'full'];
const heightByState = {
  collapsed: 0.19,
  half: 0.56,
  full: 0.9,
};

export default function BottomSheet({ state, setState, children }) {
  const startY = useRef(0);
  const pointerId = useRef(null);
  const startHeight = useRef(heightByState[state]);
  const lastExpandedState = useRef(state === 'collapsed' ? 'half' : state);
  const [dragging, setDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState(0);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setState('collapsed');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [setState]);

  useEffect(() => {
    if (state !== 'collapsed') {
      lastExpandedState.current = state;
    }
  }, [state]);

  const onPointerDown = (event) => {
    pointerId.current = event.pointerId;
    startY.current = event.clientY;
    startHeight.current = heightByState[state];
    setDragging(true);
    setDragOffset(0);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event) => {
    if (!dragging) return;
    setDragOffset(event.clientY - startY.current);
  };

  const onPointerUp = (event) => {
    if (!dragging) return;
    if (pointerId.current !== null && event.pointerId !== pointerId.current) return;

    const viewportHeight = window.innerHeight || 1;
    const deltaRatio = (event.clientY - startY.current) / viewportHeight;
    const targetHeight = Math.min(0.92, Math.max(0.12, startHeight.current - deltaRatio));
    const nextState = order.reduce((closest, option) => {
      const currentDistance = Math.abs(heightByState[option] - targetHeight);
      const closestDistance = Math.abs(heightByState[closest] - targetHeight);
      return currentDistance < closestDistance ? option : closest;
    }, order[0]);

    setState(nextState);
    pointerId.current = null;
    setDragging(false);
    setDragOffset(0);
  };

  const onPointerCancel = () => {
    pointerId.current = null;
    setDragging(false);
    setDragOffset(0);
  };

  const toggleSheetState = () => {
    if (state === 'collapsed') {
      setState(lastExpandedState.current || 'half');
      return;
    }

    setState('collapsed');
  };

  return (
    <div
      className={`bottom-sheet ${state} ${dragging ? 'dragging' : ''}`}
      style={{ '--sheet-drag-offset': `${dragOffset}px` }}
    >
      <div
        className="sheet-handle-zone"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        <div className="sheet-handle" />
      </div>
      <div className="sheet-actions">
        <button type="button" className="sheet-toggle-link" onClick={toggleSheetState}>
          {state === 'collapsed' ? 'Expand' : 'Collapse'}
        </button>
      </div>
      <div className="bottom-sheet-content">{children}</div>
    </div>
  );
}
