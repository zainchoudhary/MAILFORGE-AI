import { useState } from 'react';
import { Inbox, Loader2, AlertCircle, ArrowRight, UploadCloud, ShieldAlert, LogOut, Trash2 } from 'lucide-react';
import { Button } from './ui/button';
import { useAction } from '../hooks/useApi';
import { api } from '../services/api';
import { Dialog } from './ui/dialog';
export function PageHeader({ eyebrow = 'WORKSPACE', title, description, children }) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="flex gap-3 flex-wrap">{children}</div>
    </div>
  );
}
export function Empty({
  title = 'Nothing here yet',
  description = 'Your workspace activity will appear here.',
  action,
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Inbox size={25} />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function Loading({ queryKey = [] }) {
  const path = String(queryKey[0] || '');
  const kind = path.includes('analytics') || path.includes('overview') ? 'dashboard' : path.includes('templates') ? 'cards' : path.includes('documents') || path.includes('recipients') || path.includes('campaigns') || path.includes('activity') || path.includes('failures') ? 'table' : 'panel';
  return (
    <div className="loading-state" role="status" aria-label="Loading">
      <div className="skeleton-wrap">
        {kind === 'dashboard' && <div className="loading-skeleton-grid"><div className="skeleton h-36" /><div className="skeleton h-36" /><div className="skeleton h-36" /></div>}
        {kind === 'cards' && <div className="loading-card-grid">{[1, 2, 3, 4].map((i) => <div className="skeleton h-36" key={i} />)}</div>}
        {kind === 'table' && <div className="loading-table">{[1, 2, 3, 4, 5, 6].map((i) => <div className="skeleton loading-table-row" key={i} />)}</div>}
        {kind === 'panel' && <><div className="skeleton h-8 w-1/3" /><div className="skeleton h-56" /></>}
      </div>
    </div>
  );
}
export function QueryState({ query, children }) {
  if (query.isPending) return <Loading queryKey={query.queryKey} />;
  if (query.isError)
    return (
      <div className="error-panel">
        <AlertCircle />
        <h3>Unable to load this view</h3>
        <p>{query.error.response?.data?.detail || query.error.message}</p>
        <Button onClick={() => query.refetch()}>Try again</Button>
      </div>
    );
  return children(query.data);
}
export function Status({ value }) {
  return (
    <span className={`status status-${value}`}>
      <span />
      {(value || 'unknown').replaceAll('_', ' ')}
    </span>
  );
}
export function BusyButton({ busy, children, ...props }) {
  return (
    <Button {...props} disabled={busy || props.disabled} aria-busy={!!busy}>
      {busy && <Loader2 size={16} className="animate-spin" />}
      {children}
    </Button>
  );
}
export function ConfirmDialog({ open, onOpenChange, title = 'Confirm deletion', itemLabel, message, confirmLabel = 'Delete permanently', processingLabel, onConfirm }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const isLogout = /sign out/i.test(title);
  const isDelete = /delete/i.test(confirmLabel);
  const Icon = isLogout ? LogOut : isDelete ? Trash2 : ShieldAlert;
  async function confirm() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (requestError) {
      setError(requestError.response?.data?.detail || requestError.message || 'Action failed. Please try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) setError(''); onOpenChange(next); }} busy={busy} title={title} icon={Icon} description="Review this action before confirming." className={`confirm-modal ${isDelete ? 'confirm-delete' : 'confirm-neutral'}`}>
      <div className="confirm-modal-body">
        <p>{message || <>Are you sure you want to delete <strong>{itemLabel}</strong>? This action cannot be undone.</>}</p>
        {error && <div className="error-panel" role="alert">{error}</div>}
        <div className="confirm-modal-actions">
          <Button type="button" variant="secondary" disabled={busy} onClick={() => onOpenChange(false)}>{isLogout ? 'Stay signed in' : isDelete ? 'Keep it' : 'Go back'}</Button>
          <BusyButton type="button" variant={isDelete ? 'destructive' : 'default'} busy={busy} onClick={confirm}>
            {busy ? (processingLabel || `${confirmLabel.replace(/ permanently$/i, '')}…`) : confirmLabel}
          </BusyButton>
        </div>
      </div>
    </Dialog>
  );
}
export function Field({ label, error, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {error && <small className="text-red-400">{error.message || error}</small>}
    </label>
  );
}
export function Pagination({ data, page, setPage }) {
  return (
    <div className="pagination">
      <span>
        {data.total} records · page {page}
      </span>
      <Button variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>
        Previous
      </Button>
      <Button
        variant="ghost"
        disabled={page * data.limit >= data.total}
        onClick={() => setPage(page + 1)}
      >
        Next <ArrowRight size={14} />
      </Button>
    </div>
  );
}
export function Uploader({ onUploaded, onBusyChange, multiple = true, compact = false }) {
  const upload = useAction(async (files) => {
    const docs = [];
    for (const file of files) {
      const body = new FormData();
      body.append('file', file);
      docs.push((await api.post('/documents/upload', body)).data);
    }
    return docs;
  }, 'Files uploaded securely', {
    invalidatePrefixes: ['/documents'],
    onSuccess: (docs) => onUploaded?.(docs),
    onSettled: () => onBusyChange?.(false),
  });
  return (
    <label className={`upload-zone ${compact ? 'compact' : ''}`}>
      <input
        type="file"
        multiple={multiple}
        accept=".pdf,.docx,.doc,.xlsx,.xls,.csv,.xml,.txt,.json,.png,.jpg,.jpeg"
        disabled={upload.isPending}
        onChange={(e) => {
          if (e.target.files.length) {
            onBusyChange?.(true);
            upload.mutate([...e.target.files]);
          }
          e.target.value = '';
        }}
      />
      <UploadCloud size={compact ? 22 : 32} />
      <strong>{upload.isPending ? 'Uploading…' : 'Choose documents to upload'}</strong>
      <span>PDF, Office, spreadsheets, text & images · up to 18 MB per file</span>
    </label>
  );
}
export const dateLabel = (value) => {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString(undefined, {
      timeZone: sessionStorage.getItem('mf_timezone') || undefined,
    });
  } catch {
    return new Date(value).toLocaleString();
  }
};
export const sizeLabel = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;
