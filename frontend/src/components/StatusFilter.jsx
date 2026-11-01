import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown, SlidersHorizontal } from 'lucide-react';

const label = (value) => value ? value.replaceAll('_', ' ').replace(/^./, (c) => c.toUpperCase()) : 'All statuses';
export default function StatusFilter({ value, onChange, statuses, label: accessibleLabel }) {
  const [open, setOpen] = useState(false);
  const root = useRef(null);
  const trigger = useRef(null);
  const id = useId();
  const options = ['', ...statuses];
  useEffect(() => {
    if (!open) return;
    const close = (event) => { if (!root.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('pointerdown', close);
    root.current?.querySelector('[aria-selected="true"]')?.focus();
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  return (
    <div className="status-filter" ref={root} onBlur={(e) => {
      if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
    }} onKeyDown={(e) => {
      if (e.key === 'Escape') { setOpen(false); trigger.current?.focus(); }
      if (open && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
        e.preventDefault();
        const items = [...root.current.querySelectorAll('[role="option"]')];
        const index = items.indexOf(document.activeElement);
        const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (index + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      }
    }}>
      <button type="button" ref={trigger} className="status-filter-trigger" aria-label={`${accessibleLabel}: ${label(value)}`} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(!open)}>
        <SlidersHorizontal size={15} /><span>{label(value)}</span><ChevronDown size={15} />
      </button>
      {open && <div className="status-filter-menu" id={id} role="listbox" aria-label={accessibleLabel}>
        {options.map((status) => <button type="button" role="option" aria-selected={value === status} key={status} className="status-filter-option" onClick={() => { onChange(status); setOpen(false); trigger.current?.focus(); }}>
          <span aria-hidden="true" className={`status-filter-dot status-filter-dot-${status || 'all'}`} />
          <span>{label(status)}</span>{value === status && <Check size={15} />}
        </button>)}
      </div>}
    </div>
  );
}
