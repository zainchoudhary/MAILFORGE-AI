import { useEffect, useState } from 'react';
import { api, errorText, downloadFile } from '../services/api';
import { Dialog } from './ui/dialog';
import { Button } from './ui/button';
export function FilePreview({ document, onClose }) {
  const [content, setContent] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let url;
    let active = true;
    setContent(null);
    setError('');
    if (document)
      api
        .get(`/documents/${document.id}/preview`, { responseType: 'blob' })
        .then(async ({ data }) => {
          if (!active) return;
          if (data.type.startsWith('image/')) {
            url = URL.createObjectURL(data);
            setContent({ image: url });
          } else {
            const text = await data.text();
            if (active) setContent({ text });
          }
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
      if (url) URL.revokeObjectURL(url);
    };
  }, [document]);
  return (
    <Dialog open={!!document} onOpenChange={onClose} title={document?.filename || 'File preview'}>
      <div className="mt-5">
        {error ? (
          <p>{error}</p>
        ) : !content ? (
          <p>Loading secure preview…</p>
        ) : content.image ? (
          <img
            src={content.image}
            alt={document.filename}
            className="max-h-[65vh] mx-auto object-contain"
          />
        ) : (
          <pre className="text-xs whitespace-pre-wrap max-h-[60vh] overflow-auto">
            {content.text}
          </pre>
        )}
        <Button
          className="mt-4"
          variant="secondary"
          onClick={() => downloadFile(`/documents/${document.id}/download`, document.filename)}
        >
          Download original
        </Button>
      </div>
    </Dialog>
  );
}
