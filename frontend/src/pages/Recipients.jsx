import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { FileScan, Plus, Pencil, Trash2, Loader2, Users, Upload, Mail, Building2, ListChecks } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useApi, useAction } from '../hooks/useApi';
import { api } from '../services/api';
import {
  PageHeader,
  QueryState,
  Empty,
  Status,
  Pagination,
  Field,
  BusyButton,
  ConfirmDialog,
  Uploader,
} from '../components/Common';
import { Button } from '../components/ui/button';
import { Dialog } from '../components/ui/dialog';
import { toast } from 'sonner';
import { reviewRows, importReviewedRecipients, importSummary } from '../services/recipientImport';
const schema = z.object({
  email: z.string().email(),
  name: z.string().trim().min(1, 'Name is required'),
  company: z.string(),
  position: z.string(),
});
export default function Recipients() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(null);
  const [open, setOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [importOpen, setImportOpen] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [importDocument, setImportDocument] = useState(null);
  const [importRows, setImportRows] = useState(null);
  const extraction = useApi(`/documents/${importDocument?.id}/recipients`, {
    enabled: !!importDocument,
    refetchInterval: (query) =>
      ['pending', 'processing'].includes(query.state.data?.status) ? 1500 : false,
  });
  useEffect(() => {
    if (extraction.data?.status === 'completed' && importDocument) {
      toast.success('Document analyzed. Review the suggested recipients.');
    }
  }, [extraction.data?.status, importDocument]);
  const query = useApi(`/recipients?page=${page}&q=${encodeURIComponent(q)}`);
  useEffect(() => {
    if (query.data?.total === 0) {
      setSelectionMode(false);
      setSelectedIds([]);
    }
  }, [query.data?.total]);
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: { email: '', name: '', company: '', position: '' },
  });
  const save = useAction(async (values) => {
    const payload = { ...values, custom_fields: editing?.custom_fields || {} };
    if (editing) await api.put(`/recipients/${editing.id}`, payload);
    else await api.post('/recipients', payload);
  }, 'Recipient saved', { onSuccess: () => setOpen(false) });
  const removeFromCache = (ids) => (data) => {
    if (!data?.items) return data;
    const items = data.items.filter((recipient) => !ids.includes(recipient.id));
    return { ...data, items, total: Math.max(0, data.total - (data.items.length - items.length)) };
  };
  const remove = useAction((id) => api.delete(`/recipients/${id}`), 'Recipient removed', {
    invalidatePrefixes: ['/recipients'],
    awaitRefetch: false,
    onConfirmed: (_, id, __, client) => client.setQueriesData(
      { predicate: (item) => typeof item.queryKey[0] === 'string' && item.queryKey[0].startsWith('/recipients') },
      removeFromCache([id]),
    ),
  });
  const bulkRemove = useAction(
    (ids) => api.post('/recipients/bulk-delete', { recipient_ids: ids }),
    'Recipients removed',
    {
      invalidatePrefixes: ['/recipients'],
      awaitRefetch: false,
      onConfirmed: (_, ids, __, client) => client.setQueriesData(
        { predicate: (item) => typeof item.queryKey[0] === 'string' && item.queryKey[0].startsWith('/recipients') },
        removeFromCache(ids),
      ),
    },
  );
  const extractDocument = useAction(async (document) => {
    setImportDocument(document);
    setImportRows(null);
    const { data } = await api.post(`/documents/${document.id}/extract`);
    queryClient.setQueryData([`/documents/${document.id}/recipients`], data);
    if (data.status === 'completed') setImportRows(data.records || []);
    return data;
  }, null, { invalidatePrefixes: ['/documents'] });
  const extracting = extractDocument.isPending || ['pending', 'processing'].includes(extraction.data?.status);
  const extractionLabel = extractDocument.isPending && !['pending', 'processing'].includes(extraction.data?.status)
    ? 'Starting extraction…'
    : extraction.data?.status === 'pending' ? 'Waiting for analysis…' : 'Extracting contacts…';
  const importRecipients = useAction(async () => {
    return importReviewedRecipients(reviewRows(importRows, extraction.data));
  }, importSummary, {
    invalidatePrefixes: ['/recipients', '/analytics'],
    onSuccess: () => {
      setImportRows(null);
      setQ('');
      setPage(1);
      setImportDocument(null);
      setImportOpen(false);
    },
  });
  const extractedRows = reviewRows(importRows, extraction.data);
  const updateImportRow = (index, key, value) =>
    setImportRows(extractedRows.map((row, rowIndex) => (rowIndex === index ? { ...row, [key]: value } : row)));
  const contactsOnPage = query.data?.items || [];
  const companyCount = new Set(contactsOnPage.map((recipient) => recipient.company).filter(Boolean)).size;
  return (
    <>
      <PageHeader
        eyebrow="AUDIENCE WORKSPACE"
        title="People, not just addresses"
        description="Manage recipient details, personalization fields, and imported contact data."
      >
        <Button
          onClick={() => {
            setEditing(null);
            form.reset({ email: '', name: '', company: '', position: '' });
            setOpen(true);
          }}
        >
          <Plus size={16} />
          Add recipient
        </Button>
        <Button variant="secondary" onClick={() => setImportOpen(true)}>
          <FileScan size={16} />
          Import from document
        </Button>
      </PageHeader>
      <section className="audience-overview" aria-label="Audience summary">
        <div className="audience-overview-main">
          <span className="audience-overview-icon"><Users size={21} /></span>
          <div>
            <span className="audience-overview-label">CONTACT LIBRARY</span>
            <strong>{query.data?.total ?? '—'} people in your audience</strong>
            <p>Every contact stays private to this account and is ready to use across campaigns.</p>
          </div>
        </div>
        <div className="audience-metrics">
          <div><Mail size={15} /><span>Emails</span><strong>{contactsOnPage.length}</strong></div>
          <div><Building2 size={15} /><span>Companies</span><strong>{companyCount}</strong></div>
        </div>
      </section>
      <section className="panel recipients-library">
        <div className="recipients-library-heading">
          <div>
            <h2>Audience contacts</h2>
            <p>Search, update, or import the people you want to reach.</p>
          </div>
          {selectionMode && <span className="selection-indicator"><ListChecks size={15} /> {selectedIds.length} selected</span>}
        </div>
        <div className="filter-bar recipients-toolbar">
          <input
            type="search"
            aria-label="Search recipients"
            placeholder="Search names or email addresses"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
          {q && <Button variant="ghost" size="sm" onClick={() => { setQ(''); setPage(1); }}>Clear search</Button>}
          {query.data?.total > 0 && <Button
            variant={selectionMode ? 'default' : 'secondary'}
            size="sm"
            onClick={() => {
              setSelectionMode((active) => !active);
              if (selectionMode) setSelectedIds([]);
            }}
          >
            {selectionMode ? 'Done selecting' : 'Select multiple'}
          </Button>}
          {query.data?.total > 0 && selectionMode && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                const pageIds = query.data?.items?.map((recipient) => recipient.id) || [];
                const allSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.includes(id));
                setSelectedIds(allSelected
                  ? selectedIds.filter((id) => !pageIds.includes(id))
                  : [...new Set([...selectedIds, ...pageIds])]);
              }}
            >
              {query.data?.items?.length > 0 && query.data.items.every((recipient) => selectedIds.includes(recipient.id))
                ? 'Deselect all'
                : 'Select all'}
            </Button>
          )}
          {selectionMode && selectedIds.length > 0 && (
            <Button variant="destructive" size="sm" onClick={() => setBulkDeleteOpen(true)}>
              Delete {selectedIds.length} selected
            </Button>
          )}
          <ConfirmDialog
            open={bulkDeleteOpen}
            onOpenChange={setBulkDeleteOpen}
              title="Delete selected recipients"
              message={`This will remove ${selectedIds.length} selected recipient${selectedIds.length === 1 ? '' : 's'} from your library.`}
              confirmLabel="Delete selected"
              onConfirm={() => bulkRemove.mutateAsync(selectedIds).then(() => setSelectedIds([]))}
          />
        </div>
        <QueryState query={query}>
          {(d) => (
            <>
              {d.items.length ? (
                <div className="table-scroll recipients-table-wrap">
                  <table className="recipients-table">
                    <thead>
                      <tr>
                        {selectionMode && <th aria-label="Selection" />}
                        <th>Recipient</th>
                        <th>Company / position</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.items.map((r) => (
                        <tr key={r.id}>
                          {selectionMode && <td>
                            <input
                              type="checkbox"
                              aria-label={`Select ${r.email}`}
                              checked={selectedIds.includes(r.id)}
                              onChange={(e) => setSelectedIds((current) => e.target.checked
                                ? [...new Set([...current, r.id])]
                                : current.filter((id) => id !== r.id))}
                            />
                          </td>}
                          <td>
                            <div className="recipient-identity">
                              <span className="recipient-avatar">{(r.name || r.email).trim().slice(0, 1).toUpperCase()}</span>
                              <div>
                                <strong>{r.name || 'Unnamed contact'}</strong>
                                <small><Mail size={12} />{r.email}</small>
                              </div>
                            </div>
                          </td>
                          <td>
                            <div className="recipient-work">
                              <strong>{r.company || 'Independent'}</strong>
                              <small>{r.position || 'No role added yet'}</small>
                            </div>
                          </td>
                          <td>
                            <div className="flex gap-2">
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label={`Edit ${r.email}`}
                                title="Edit contact"
                                onClick={() => {
                                  setEditing(r);
                                  form.reset({
                                    email: r.email,
                                    name: r.name,
                                    company: r.company,
                                    position: r.position,
                                  });
                                  setOpen(true);
                                }}
                              >
                                <Pencil size={15} />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label={`Remove ${r.email}`}
                                title="Delete contact"
                                onClick={() => {
                                  setDeleteTarget(r);
                                }}
                              >
                                <Trash2 size={15} />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="recipients-empty">
                  <span><Users size={29} /></span>
                  <h3>Start with your first contact</h3>
                  <p>Add one person yourself or upload a document and review the contacts it finds.</p>
                  <div>
                    <Button onClick={() => { setEditing(null); form.reset({ email: '', name: '', company: '', position: '' }); setOpen(true); }}><Plus size={15} /> Add recipient</Button>
                    <Button variant="secondary" onClick={() => setImportOpen(true)}><Upload size={15} /> Import contacts</Button>
                  </div>
                </div>
              )}
              <Pagination data={d} page={page} setPage={setPage} />
            </>
          )}
        </QueryState>
      </section>
      <Dialog open={importOpen} onOpenChange={setImportOpen} busy={uploadBusy || extractDocument.isPending || importRecipients.isPending} title="Import recipients from a document">
        <p className="my-4">
          Upload a contact list, spreadsheet, PDF, Word file, image, or text document. Outreach Studio
          will find emails and available details, then let you review everything before saving.
        </p>
        {!importDocument && (
          <Uploader
            compact
            multiple={false}
            onBusyChange={setUploadBusy}
            onUploaded={(items) => {
              if (items[0]) {
                setImportDocument(items[0]);
                setImportRows(null);
              }
            }}
          />
        )}
        {importDocument && (
          <div className="mt-4">
            <div className="panel-heading">
              <div>
                <strong>{importDocument.filename}</strong>
                <small>{extraction.data?.duplicates || 0} duplicate occurrences removed</small>
              </div>
              <Status value={extraction.data?.status || 'not_started'} />
            </div>
            {(extracting || !extraction.data || ['not_started', 'failed'].includes(extraction.data.status)) && (
              <div className="flex justify-end mt-4">
                <BusyButton
                  busy={extracting}
                  onClick={() => extractDocument.mutate(importDocument)}
                >
                  <FileScan size={15} />
                  {extracting ? extractionLabel : extraction.data?.status === 'failed' ? 'Retry extraction' : 'Extract contacts'}
                </BusyButton>
              </div>
            )}
            {extracting && (
              <div className="info-banner mt-4" role="status" aria-live="polite">
                <Loader2 size={24} className="animate-spin shrink-0" aria-hidden="true" />
                <div>
                  <strong>{extractionLabel}</strong>
                  <p>{extraction.data?.status === 'pending'
                    ? 'Your document is queued. Contacts will appear here automatically when analysis finishes.'
                    : 'Reading your document and finding email addresses. Large or scanned files can take longer.'}</p>
                  <small>No contacts are saved until you review and import them.</small>
                </div>
              </div>
            )}
            {extraction.data?.error && <div className="error-panel">{extraction.data.error}</div>}
            {extraction.isError && <div className="error-panel" role="alert">Unable to check extraction progress. <Button variant="ghost" onClick={() => extraction.refetch()}>Check again</Button></div>}
            {extractedRows.length ? (
              <div className="table-scroll">
                <div className="flex justify-between items-center mb-3">
                  <small>Name and email are required · {extractedRows.filter((row) => row.selected !== false).length} of {extractedRows.length} selected</small>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      const selectAll = extractedRows.some((row) => row.selected === false);
                      setImportRows(extractedRows.map((row) => ({ ...row, selected: selectAll })));
                    }}
                  >
                    {extractedRows.some((row) => row.selected === false) ? 'Select all' : 'Deselect all'}
                  </Button>
                </div>
                <table>
                  <thead><tr><th>Select</th><th>Email <span className="required-mark" aria-label="required">*</span></th><th>Name <span className="required-mark" aria-label="required">*</span></th><th>Company</th><th>Position</th></tr></thead>
                  <tbody>
                    {extractedRows.map((row, index) => (
                      <tr key={`${row.email}-${index}`}>
                        <td><input type="checkbox" checked={row.selected !== false} onChange={(e) => updateImportRow(index, 'selected', e.target.checked)} /></td>
                        {['email', 'name', 'company', 'position'].map((key) => (
                          <td key={key}><input aria-label={`${key} ${index + 1}${['email', 'name'].includes(key) ? ', required' : ''}`} aria-required={['email', 'name'].includes(key)} value={row[key] || ''} onChange={(e) => updateImportRow(index, key, e.target.value)} /></td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : !extracting && (
              <Empty title={extraction.data?.status === 'completed' ? 'No email addresses found' : ['pending', 'processing'].includes(extraction.data?.status) ? 'Analyzing document…' : 'Click Extract contacts to begin'} description="Only reviewed records will be added to your recipient library." />
            )}
            <div className="flex justify-between mt-5 gap-3">
              <Button variant="ghost" disabled={extracting} onClick={() => { setImportDocument(null); setImportRows(null); }}>Choose another file</Button>
              <BusyButton busy={importRecipients.isPending} disabled={extracting || !extractedRows.some((row) => row.selected !== false && row.email)} onClick={() => importRecipients.mutate()}>
                Import selected recipients
              </BusyButton>
            </div>
          </div>
        )}
      </Dialog>
      <ConfirmDialog
        open={!!deleteTarget}
        itemLabel={deleteTarget?.email}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        onConfirm={() => remove.mutateAsync(deleteTarget.id)}
      />
      <Dialog
        open={open}
        onOpenChange={setOpen}
        busy={save.isPending}
        title={editing ? 'Edit recipient' : 'Add recipient'}
      >
        <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="mt-5">
          {['email', 'name', 'company', 'position'].map((key) => (
            <Field
              key={key}
              label={key === 'name' ? 'Full name' : key[0].toUpperCase() + key.slice(1)}
              required={key === 'email' || key === 'name'}
              error={form.formState.errors[key]}
            >
              <input {...form.register(key)} required={key === 'email' || key === 'name'} disabled={key === 'email' && !!editing} />
            </Field>
          ))}
          <BusyButton busy={save.isPending} type="submit">
            {save.isPending ? 'Saving…' : 'Save recipient'}
          </BusyButton>
        </form>
      </Dialog>
    </>
  );
}
