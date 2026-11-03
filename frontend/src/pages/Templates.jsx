import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Layers, Plus, Trash2 } from 'lucide-react';
import { useApi, useAction } from '../hooks/useApi';
import { api } from '../services/api';
import { PageHeader, QueryState, Empty, Field, BusyButton, ConfirmDialog, PickerDropdown } from '../components/Common';
import { Button } from '../components/ui/button';
import { Dialog } from '../components/ui/dialog';
import { RichEditor } from '../components/RichEditor';
export default function Templates() {
  const query = useApi('/templates');
  const docs = useApi('/documents?limit=100');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [attachment, setAttachment] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const linked = useApi(`/templates/${editing?.id}/attachments`, { enabled: !!editing });
  const unlink = useAction(
    (documentId) => api.delete(`/templates/${editing.id}/attachments/${documentId}`),
    'Attachment removed',
  );
  const remove = useAction((id) => api.delete(`/templates/${id}`), 'Template deleted');
  const form = useForm({
    resolver: zodResolver(
      z.object({ name: z.string().min(1), subject: z.string().min(1), body: z.string().min(8) }),
    ),
    defaultValues: { name: '', subject: '', body: '' },
  });
  const save = useAction(async (values) => {
    const { data } = editing
      ? await api.put(`/templates/${editing.id}`, values)
      : await api.post('/templates', values);
    if (attachment) await api.post(`/templates/${data.id}/attachments/${attachment}`);
  }, 'Template saved', { onSuccess: () => setOpen(false) });
  function show(t) {
    setEditing(t);
    form.reset(
      t ? { name: t.name, subject: t.subject, body: t.body } : { name: '', subject: '', body: '' },
    );
    setAttachment('');
    setOpen(true);
  }
  return (
    <>
      <PageHeader
        eyebrow="YOUR MESSAGE LIBRARY"
        title="Templates with a personal touch"
        description="Reusable foundations for thoughtful, consistent communication."
      >
        <Button onClick={() => show(null)}>
          <Plus size={16} />
          Create template
        </Button>
      </PageHeader>
      <QueryState query={query}>
        {(d) =>
          d.items.length ? (
            <div className="card-grid">
              {d.items.map((t) => (
                <div className="panel template-card" key={t.id}>
                  <button className="template-card-main" onClick={() => show(t)}>
                    <div className="template-icon">
                      <Layers size={22} />
                    </div>
                    <h3>{t.name}</h3>
                    <p>{t.subject}</p>
                    <small>Edit template <span>→</span></small>
                  </button>
                  <div className="template-card-footer">
                    <span>Reusable message</span>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setDeleteTarget(t)}><Trash2 size={14} /> Delete</Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <section className="panel">
              <Empty
                title="Write once. Make it personal every time."
                description="Create your first reusable email template."
              />
            </section>
          )
        }
      </QueryState>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        busy={save.isPending || unlink.isPending}
        title={editing ? 'Edit template' : 'Create template'}
      >
        <form className="mt-5" onSubmit={form.handleSubmit((v) => save.mutate(v))}>
          <Field label="Template name" error={form.formState.errors.name}>
            <input {...form.register('name')} />
          </Field>
          <Field label="Subject" error={form.formState.errors.subject}>
            <input {...form.register('subject')} />
          </Field>
          <Field label="Body" error={form.formState.errors.body}>
            <RichEditor value={form.watch('body')} onChange={(v) => form.setValue('body', v)} />
          </Field>
          <Field label="Associate a private attachment">
            <PickerDropdown
              value={attachment}
              onChange={setAttachment}
              placeholder="Reuse a private workspace file"
              ariaLabel="Choose a private workspace file"
              options={[
                { value: '', label: 'No additional attachment', description: 'Send this template without a file' },
                ...(docs.data?.items || []).map((document) => ({ value: document.id, label: document.filename, description: 'Private workspace document' })),
              ]}
            />
          </Field>
          {linked.data?.items.map((d) => (
            <div className="file-row" key={d.id}>
              <span>{d.filename}</span>
              <Button type="button" variant="ghost" size="sm" onClick={() => unlink.mutate(d.id)}>
                Remove
              </Button>
            </div>
          ))}
          <BusyButton busy={save.isPending}>{save.isPending ? 'Saving…' : 'Save template'}</BusyButton>
        </form>
      </Dialog>
      <ConfirmDialog
        open={!!deleteTarget}
        itemLabel={deleteTarget?.name}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        onConfirm={() => remove.mutateAsync(deleteTarget.id)}
      />
    </>
  );
}
