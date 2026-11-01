import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X, Layers } from 'lucide-react';
export function Dialog({ open, onOpenChange, title, children, className = '', icon: Icon = Layers, description = 'Review the details below.', busy = false }) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="modal-overlay" />
        <DialogPrimitive.Content className={`modal ${className}`}>
          <div className="modal-heading">
            <div className="modal-symbol" aria-hidden="true"><Icon size={22} /></div>
            <DialogPrimitive.Title className="text-xl font-semibold">{title}</DialogPrimitive.Title>
          </div>
          <DialogPrimitive.Description className="sr-only">
            {description}
          </DialogPrimitive.Description>
          <DialogPrimitive.Close disabled={busy} className="modal-close" aria-label="Close">
            <X size={18} />
          </DialogPrimitive.Close>
          <fieldset disabled={busy} aria-busy={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
            <div inert={busy ? '' : undefined}>{children}</div>
          </fieldset>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
