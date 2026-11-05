import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Moon, Palette, Sun } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';

const OPTIONS = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
];

export function ThemeToggle({ className = '' }) {
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const root = useRef(null);
  const ActiveIcon = theme === 'dark' ? Moon : Sun;

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event) => {
      if (!root.current?.contains(event.target)) setOpen(false);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className={`appearance-menu ${className}`.trim()} ref={root}>
      <button
        type="button"
        className="theme-toggle appearance-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Appearance"
        title="Appearance"
        onClick={() => setOpen((current) => !current)}
      >
        <span>
          <Palette size={16} aria-hidden="true" />
          <span>Appearance</span>
        </span>
        <span className="appearance-trigger-meta">
          <ActiveIcon size={14} aria-hidden="true" />
          <ChevronDown size={14} className={open ? 'open' : ''} aria-hidden="true" />
        </span>
      </button>
      {open && (
        <div className="appearance-menu-panel" role="listbox" aria-label="Appearance">
          {OPTIONS.map(({ value, label, Icon }) => {
            const selected = theme === value;
            return (
              <button
                type="button"
                key={value}
                role="option"
                aria-selected={selected}
                className={selected ? 'selected' : ''}
                onClick={() => {
                  setTheme(value);
                  setOpen(false);
                }}
              >
                <span>
                  <Icon size={15} aria-hidden="true" />
                  <strong>{label}</strong>
                </span>
                {selected && <Check size={15} aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
