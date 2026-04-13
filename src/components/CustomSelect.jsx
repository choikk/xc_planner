import { useEffect, useMemo, useRef, useState } from 'react';

export default function CustomSelect({
  value,
  options,
  onChange,
  disabled = false,
  ariaLabel,
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const selectedOption = useMemo(
    () => options.find((option) => option.value === value) || options[0] || null,
    [options, value]
  );

  useEffect(() => {
    if (!open) return undefined;

    const handlePointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    setOpen(false);
  }, [value, options]);

  return (
    <div ref={rootRef} className={`custom-select ${open ? 'open' : ''} ${disabled ? 'disabled' : ''}`}>
      <button
        type="button"
        className="custom-select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          setOpen((current) => !current);
        }}
      >
        <span className="custom-select-value">{selectedOption?.label || ''}</span>
        <span className="custom-select-caret" aria-hidden="true">
          {open ? '▴' : '▾'}
        </span>
      </button>

      {open && !disabled && (
        <div className="custom-select-panel" role="listbox" aria-label={ariaLabel}>
          {options.map((option) => {
            const active = option.value === value;

            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={active}
                className={`custom-select-option ${active ? 'active' : ''}`}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
