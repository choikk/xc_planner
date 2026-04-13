import { useEffect, useRef, useState } from 'react';

const order = ['collapsed', 'half', 'full'];

export default function BottomSheet({ state, setState, children }) {
  const startY = useRef(0);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setState('collapsed');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [setState]);

  const onPointerDown = (event) => {
    startY.current = event.clientY;
    setDragging(true);
  };

  const onPointerUp = (event) => {
    if (!dragging) return;
    const delta = event.clientY - startY.current;
    const currentIndex = order.indexOf(state);
    if (delta < -40 && currentIndex < order.length - 1) setState(order[currentIndex + 1]);
    if (delta > 40 && currentIndex > 0) setState(order[currentIndex - 1]);
    setDragging(false);
  };

  return (
    <div className={`bottom-sheet ${state}`}>
      <div className="sheet-handle-zone" onPointerDown={onPointerDown} onPointerUp={onPointerUp}>
        <div className="sheet-handle" />
      </div>
      <div className="sheet-actions">
        {order.map((option) => (
          <button
            key={option}
            type="button"
            className={state === option ? 'active' : ''}
            onClick={() => setState(option)}
          >
            {option}
          </button>
        ))}
      </div>
      <div className="bottom-sheet-content">{children}</div>
    </div>
  );
}
