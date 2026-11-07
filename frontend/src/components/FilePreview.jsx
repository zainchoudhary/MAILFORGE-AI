import { useEffect, useState } from 'react';
import { api, errorText, downloadFile } from '../services/api';
import { Dialog } from './ui/dialog';
import { Button } from './ui/button';

function isImageBlob(blob) {
  return Boolean(blob?.type?.startsWith('image/'));
}

function isPdfDocument(document, blob) {
  const name = (document?.filename || '').toLowerCase();
  const type = (blob?.type || document?.mime_type || '').toLowerCase();
  return type.includes('pdf') || name.endsWith('.pdf');
}

function isSpreadsheetDocument(document, blob) {
  const name = (document?.filename || '').toLowerCase();
  const type = (blob?.type || document?.mime_type || '').toLowerCase();
  return (
    type.includes('json') ||
    name.endsWith('.xlsx') ||
    name.endsWith('.xls') ||
    name.endsWith('.csv')
  );
}

function SpreadsheetPreview({ payload }) {
  const sheets = payload?.sheets || [];
  const [sheetIndex, setSheetIndex] = useState(0);
  const active = sheets[Math.min(sheetIndex, Math.max(sheets.length - 1, 0))] || {
    headers: [],
    rows: [],
    name: 'Sheet',
  };
  const colCount = Math.max(active.headers.length, 1);

  return (
    <div className="file-preview-sheet">
      <p className="mb-3 file-preview-hint">
        Spreadsheet preview
        {payload.truncated
          ? ` — showing the first ${payload.max_rows} rows per sheet. Download the original for the full file.`
          : ' — grid view of your workbook.'}
      </p>
      {sheets.length > 1 && (
        <div className="file-preview-sheet-tabs" role="tablist" aria-label="Workbook sheets">
          {sheets.map((sheet, index) => (
            <button
              key={`${sheet.name}-${index}`}
              type="button"
              role="tab"
              aria-selected={index === sheetIndex}
              className={index === sheetIndex ? 'active' : ''}
              onClick={() => setSheetIndex(index)}
            >
              {sheet.name}
            </button>
          ))}
        </div>
      )}
      <div className="file-preview-sheet-scroll">
        <table>
          <thead>
            <tr>
              <th className="file-preview-sheet-corner" scope="col">
                #
              </th>
              {active.headers.map((header, index) => (
                <th key={`h-${index}`} scope="col">
                  {header || `Column ${index + 1}`}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {active.rows.length ? (
              active.rows.map((row, rowIndex) => (
                <tr key={`r-${rowIndex}`}>
                  <th scope="row">{rowIndex + 1}</th>
                  {Array.from({ length: colCount }, (_, colIndex) => (
                    <td key={`c-${rowIndex}-${colIndex}`}>{row[colIndex] ?? ''}</td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={colCount + 1}>This sheet has no rows.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function FilePreview({ document, onClose }) {
  const [content, setContent] = useState(null);
  const [error, setError] = useState('');
  const open = !!document;

  useEffect(() => {
    const urls = [];
    let active = true;
    setContent(null);
    setError('');
    if (!document) return undefined;
    api
      .get(`/documents/${document.id}/preview`, { responseType: 'blob' })
      .then(async ({ data }) => {
        if (!active) return;
        if (isPdfDocument(document, data)) {
          const url = URL.createObjectURL(data);
          urls.push(url);
          setContent({ kind: 'pdf', url });
          return;
        }
        if (isImageBlob(data)) {
          const url = URL.createObjectURL(data);
          urls.push(url);
          setContent({ kind: 'image', url });
          return;
        }
        const text = await data.text();
        if (isSpreadsheetDocument(document, data)) {
          try {
            const parsed = JSON.parse(text);
            if (parsed?.kind === 'spreadsheet') {
              setContent({ kind: 'spreadsheet', payload: parsed });
              return;
            }
          } catch {
            // Fall through to plain text if JSON is unexpected.
          }
        }
        if (active) setContent({ kind: 'text', text });
      })
      .catch(async (e) => {
        let message = errorText(e);
        if (e.response?.data instanceof Blob) {
          try {
            message = JSON.parse(await e.response.data.text()).detail;
          } catch {}
        }
        if (active) setError(message);
      });
    return () => {
      active = false;
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [document]);

  const wide = content?.kind === 'pdf' || content?.kind === 'spreadsheet';

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={document?.filename || 'File preview'}
      className={wide ? 'modal-file-preview' : ''}
      description="Preview of the selected attachment."
    >
      <div className="mt-5">
        {!document ? null : error ? (
          <p>{error}</p>
        ) : !content ? (
          <p>Loading secure preview…</p>
        ) : content.kind === 'pdf' ? (
          <>
            <p className="mb-3 file-preview-hint">
              Full PDF preview — scroll inside the viewer to see every page.
            </p>
            <iframe
              className="file-preview-pdf"
              title={document.filename}
              src={`${content.url}#toolbar=1&navpanes=0`}
            />
          </>
        ) : content.kind === 'spreadsheet' ? (
          <SpreadsheetPreview payload={content.payload} />
        ) : content.kind === 'image' ? (
          <img
            src={content.url}
            alt={document.filename}
            className="max-h-[65vh] mx-auto object-contain"
          />
        ) : (
          <>
            <p className="mb-3 file-preview-hint">
              Readable preview of this attachment. Download the original for the full file.
            </p>
            <pre className="file-preview-text">{content.text}</pre>
          </>
        )}
        {document && (
          <Button
            className="mt-4"
            variant="secondary"
            onClick={() => downloadFile(`/documents/${document.id}/download`, document.filename)}
          >
            Download original
          </Button>
        )}
      </div>
    </Dialog>
  );
}
