import { useState } from 'react';
import { FilePreview } from '../components/FilePreview';
import { Check, Download, FileScan, FileText, Plus, ScanLine, Trash2, Users } from 'lucide-react';
import { useApi, useAction } from '../hooks/useApi';
import { api, downloadFile } from '../services/api';
import {
  PageHeader,
  QueryState,
  Empty,
  Uploader,
  Status,
  BusyButton,
  sizeLabel,
  Pagination,
  ConfirmDialog,
} from '../components/Common';
import { Button } from '../components/ui/button';
export default function Documents() {
  const [previewFile, setPreviewFile] = useState(null);
  const [page, setPage] = useState(1);
  const docs = useApi(`/documents?page=${page}`);
  const [selected, setSelected] = useState(null);
  const extraction = useApi(`/documents/${selected?.id}/recipients`, {
    enabled: !!selected,
    refetchInterval: (q) =>
      ['pending', 'processing'].includes(q.state.data?.status) ? 2000 : false,
  });
  const [rows, setRows] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const extract = useAction(async (doc) => {
    setSelected(doc);
    setRows(null);
    const { data } = await api.post(`/documents/${doc.id}/extract`);
    setRows(data.status === 'completed' ? data.records || [] : null);
    return data;
  }, 'Extraction complete');
  const remove = useAction((id) => api.delete(`/documents/${id}`), 'Document deleted');
  const records = rows ?? extraction.data?.records ?? [];
  const importAction = useAction(async () => {
    let added = 0,
      duplicates = 0;
    for (const r of records.filter((r) => r.selected !== false)) {
      const { selected, ...payload } = r;
      try {
        await api.post('/recipients', payload);
        added++;
      } catch (e) {
        if (e.response?.status === 409) duplicates++;
        else throw e;
      }
    }
    setRows([]);
    return { added, duplicates };
  }, 'Reviewed recipients saved; duplicates were skipped. Record consent before sending.');
  function edit(index, key, value) {
    setRows(records.map((r, i) => (i === index ? { ...r, [key]: value } : r)));
  }
  return (
    <>
      <PageHeader
        eyebrow="DOCUMENT INTELLIGENCE"
        title="Your documents have something to say"
        description="Extract structured contacts. Review the audience. Keep the human in the loop."
      />
      <div className="document-top">
        <Uploader
          onUploaded={(items) => {
            if (items.length) setSelected(items[0]);
          }}
        />
        <section className="panel document-note">
          <FileScan size={28} />
          <h3>From unstructured to understood</h3>
          <p>
            OCR for scanned pages. Structured fields from spreadsheets. Duplicate detection across
            your workspace.
          </p>
          <div className="quiet-note">
            Found addresses are candidates, never automatically approved recipients.
          </div>
        </section>
      </div>
      <section className="panel mt-6">
        <div className="panel-heading">
          <h3>Private document library</h3>
          <span className="period-chip">Organization access only</span>
        </div>
        <QueryState query={docs}>
          {(d) => (
            <>
              {d.items.length ? (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Document</th>
                        <th>Size</th>
                        <th>Malware scan</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.items.map((doc) => (
                        <tr key={doc.id}>
                          <td>
                            <button
                              className="table-title"
                              onClick={() => {
                                setSelected(doc);
                                setRows(null);
                              }}
                            >
                              <FileText size={16} />
                              {doc.filename}
                            </button>
                          </td>
                          <td>{sizeLabel(doc.size)}</td>
                          <td>
                            <Status value={doc.scan_status} />
                          </td>
                          <td>
                            <div className="flex gap-2">
                              <BusyButton
                                size="sm"
                                busy={extract.isPending}
                                onClick={() => extract.mutate(doc)}
                              >
                                <ScanLine size={14} />
                                Extract
                              </BusyButton>
                              <Button
                                size="icon"
                                variant="ghost"
                                aria-label={`Download ${doc.filename}`}
                                onClick={() =>
                                  downloadFile(`/documents/${doc.id}/download`, doc.filename)
                                }
                              >
                                <Download size={15} />
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => setPreviewFile(doc)}>
                                Preview
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  setDeleteTarget(doc);
                                }}
                              >
                                Delete
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty
                  title="Bring your first document"
                  description="Your files stay private to your organization."
                />
              )}
              <Pagination data={d} page={page} setPage={setPage} />
            </>
          )}
        </QueryState>
      </section>
      {selected && (
        <section className="panel mt-6">
          <div className="panel-heading">
            <div>
              <h3>Review extracted recipients</h3>
              <p>
                {selected.filename} · {extraction.data?.duplicates || 0} duplicate occurrences
                removed
              </p>
            </div>
            <Status value={extraction.data?.status || 'not_started'} />
          </div>
          {extraction.data?.error && <div className="error-panel">{extraction.data.error}</div>}
          {records.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Select</th>
                    <th>Email address</th>
                    <th>Name</th>
                    <th>Company</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {records.map((r, i) => (
                    <tr key={i}>
                      <td>
                        <input
                          aria-label={`Select ${r.email}`}
                          type="checkbox"
                          checked={r.selected !== false}
                          onChange={(e) => edit(i, 'selected', e.target.checked)}
                        />
                      </td>
                      {['email', 'name', 'company'].map((key) => (
                        <td key={key}>
                          <input
                            aria-label={`${key} row ${i + 1}`}
                            value={r[key]}
                            onChange={(e) => edit(i, key, e.target.value)}
                          />
                        </td>
                      ))}
                      <td>
                        <button
                          aria-label={`Remove ${r.email}`}
                          onClick={() => setRows(records.filter((_, n) => n !== i))}
                        >
                          <Trash2 size={15} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              title={
                extraction.data?.status === 'completed'
                  ? 'No candidates found'
                  : 'Extract this document to review candidates'
              }
              description="You can also add recipient records manually."
            />
          )}
          <div className="flex justify-between mt-5 gap-3">
            <Button
              variant="secondary"
              onClick={() =>
                setRows([
                  ...records,
                  { email: '', name: '', company: '', position: '', custom_fields: {} },
                ])
              }
            >
              <Plus size={15} />
              Add row
            </Button>
            <BusyButton
              busy={importAction.isPending}
              disabled={!records.some((r) => r.selected !== false)}
              onClick={() => importAction.mutate()}
            >
              <Check size={15} />
              Save reviewed recipients
            </BusyButton>
          </div>
        </section>
      )}
      <FilePreview document={previewFile} onClose={() => setPreviewFile(null)} />
      <ConfirmDialog
        open={!!deleteTarget}
        itemLabel={deleteTarget?.filename}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        onConfirm={() => {
          remove.mutate(deleteTarget.id);
          setDeleteTarget(null);
          if (selected?.id === deleteTarget.id) setSelected(null);
        }}
      />
    </>
  );
}
