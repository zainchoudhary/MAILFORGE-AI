import { useState } from 'react';
import { FilePreview } from '../components/FilePreview';
import { Download, FileText, ListChecks, Paperclip, Trash2 } from 'lucide-react';
import { useApi, useAction } from '../hooks/useApi';
import { api, downloadFile } from '../services/api';
import { PageHeader, QueryState, Empty, Uploader, sizeLabel, Pagination, ConfirmDialog } from '../components/Common';
import { Button } from '../components/ui/button';

export default function Documents() {
  const [previewFile, setPreviewFile] = useState(null);
  const [page, setPage] = useState(1);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedDocumentIds, setSelectedDocumentIds] = useState([]);
  const docs = useApi(`/documents?page=${page}`);
  const remove = useAction((id) => api.delete(`/documents/${id}`), 'Attachment deleted');
  const removeSelected = useAction(
    async (ids) => (await api.post('/documents/bulk-delete', { document_ids: ids })).data,
    (data) => `${data.deleted} attachments deleted`,
    { invalidatePrefixes: ['/documents'], onSuccess: () => { setSelectedDocumentIds([]); setSelectionMode(false); } },
  );
  return <>
    <PageHeader eyebrow="ATTACHMENT LIBRARY" title="Files, ready for your campaigns" description="Upload once, preview anytime, and attach private files to campaigns or templates." />
    <div className="document-top">
      <Uploader onUploaded={() => {}} />
      <section className="panel document-note"><Paperclip size={27} /><h3>Your private file library</h3><p>Files uploaded here are available only as attachments in your Outreach Studio workspace.</p><div className="quiet-note">Preview, download, attach, or remove files whenever you need.</div></section>
    </div>
    <section className="panel mt-6">
      <div className="panel-heading"><div><h3>Saved attachments</h3><p>Private to your organization and ready to reuse.</p></div><span className="period-chip">Attachment-only</span></div>
      <QueryState query={docs}>{(data) => <>
        {data.items.length ? <>
          <div className="document-library-actions">
            <small>{selectionMode ? `${selectedDocumentIds.length} selected` : 'Select files when you need to manage more than one.'}</small>
            <div>
              <Button variant={selectionMode ? 'default' : 'secondary'} size="sm" onClick={() => { setSelectionMode((active) => !active); if (selectionMode) setSelectedDocumentIds([]); }}><ListChecks size={14} /> {selectionMode ? 'Cancel' : 'Select multiple'}</Button>
              {selectionMode && <Button variant="secondary" size="sm" onClick={() => { const pageIds = data.items.map((document) => document.id); const allSelected = pageIds.length > 0 && pageIds.every((id) => selectedDocumentIds.includes(id)); setSelectedDocumentIds(allSelected ? selectedDocumentIds.filter((id) => !pageIds.includes(id)) : [...new Set([...selectedDocumentIds, ...pageIds])]); }}>{data.items.every((document) => selectedDocumentIds.includes(document.id)) ? 'Deselect all' : 'Select all'}</Button>}
              {selectionMode && selectedDocumentIds.length > 0 && <Button variant="destructive" size="sm" onClick={() => setBulkDeleteOpen(true)}><Trash2 size={14} /> Delete {selectedDocumentIds.length} selected</Button>}
            </div>
          </div>
          <div className="table-scroll"><table><thead><tr>{selectionMode && <th className="table-check" aria-label="Selection" />}<th>Attachment</th><th>Size</th><th>Actions</th></tr></thead><tbody>
            {data.items.map((document) => <tr key={document.id}>
              {selectionMode && <td className="table-check"><input aria-label={`Select ${document.filename}`} type="checkbox" checked={selectedDocumentIds.includes(document.id)} onChange={(event) => setSelectedDocumentIds((current) => event.target.checked ? [...new Set([...current, document.id])] : current.filter((id) => id !== document.id))} /></td>}
              <td><button className="table-title" onClick={() => setPreviewFile(document)}><FileText size={16} />{document.filename}</button></td><td>{sizeLabel(document.size)}</td>
              <td><div className="flex gap-2"><Button size="icon" variant="ghost" aria-label={`Download ${document.filename}`} onClick={() => downloadFile(`/documents/${document.id}/download`, document.filename)}><Download size={15} /></Button><Button size="sm" variant="ghost" onClick={() => setPreviewFile(document)}>Preview</Button><Button size="sm" variant="ghost" onClick={() => setDeleteTarget(document)}>Delete</Button></div></td>
            </tr>)}
          </tbody></table></div>
        </> : <Empty title="Upload your first attachment" description="Files here can be attached to campaigns and templates." />}
        <Pagination data={data} page={page} setPage={setPage} />
      </>}</QueryState>
    </section>
    <FilePreview document={previewFile} onClose={() => setPreviewFile(null)} />
    <ConfirmDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen} title="Delete selected attachments" message={`This will permanently delete ${selectedDocumentIds.length} selected attachment${selectedDocumentIds.length === 1 ? '' : 's'}.`} confirmLabel="Delete selected" onConfirm={() => removeSelected.mutateAsync(selectedDocumentIds)} />
    <ConfirmDialog open={!!deleteTarget} itemLabel={deleteTarget?.filename} onOpenChange={(open) => !open && setDeleteTarget(null)} confirmLabel="Delete permanently" onConfirm={() => remove.mutateAsync(deleteTarget.id)} />
  </>;
}
