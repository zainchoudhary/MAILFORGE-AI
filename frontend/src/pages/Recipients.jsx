import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Pencil, ShieldCheck, Trash2 } from 'lucide-react';
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
} from '../components/Common';
import { Button } from '../components/ui/button';
import { Dialog } from '../components/ui/dialog';
const schema = z.object({
  email: z.string().email(),
  name: z.string(),
  company: z.string(),
  position: z.string(),
});
export default function Recipients() {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(null);
  const [open, setOpen] = useState(false);
  const [consent, setConsent] = useState(null);
  const [source, setSource] = useState('');
  const [custom, setCustom] = useState('{}');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const query = useApi(`/recipients?page=${page}&q=${encodeURIComponent(q)}`);
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: { email: '', name: '', company: '', position: '' },
  });
  const save = useAction(async (values) => {
    const fields = JSON.parse(custom);
    const payload = { ...values, custom_fields: fields };
    if (editing) await api.put(`/recipients/${editing.id}`, payload);
    else await api.post('/recipients', payload);
    setOpen(false);
  }, 'Recipient saved');
  const remove = useAction((id) => api.delete(`/recipients/${id}`), 'Recipient removed');
  const recordConsent = useAction(async (granted) => {
    await api.post(`/recipients/${consent.id}/consent`, { granted, source });
    setConsent(null);
  }, 'Consent history updated');
  return (
    <>
      <PageHeader
        eyebrow="AUDIENCE WORKSPACE"
        title="People, not just addresses"
        description="Manage recipient details, personalization fields, and documented consent."
      >
        <Button
          onClick={() => {
            setEditing(null);
            form.reset({ email: '', name: '', company: '', position: '' });
            setCustom('{}');
            setOpen(true);
          }}
        >
          <Plus size={16} />
          Add recipient
        </Button>
      </PageHeader>
      <section className="panel">
        <div className="filter-bar">
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
        </div>
        <QueryState query={query}>
          {(d) => (
            <>
              {d.items.length ? (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Recipient</th>
                        <th>Company / position</th>
                        <th>Consent</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.items.map((r) => (
                        <tr key={r.id}>
                          <td>
                            <strong>{r.name || r.email}</strong>
                            <small>{r.email}</small>
                          </td>
                          <td>
                            {r.company || '—'}
                            <small>{r.position}</small>
                          </td>
                          <td>
                            <Status value={r.consent ? 'granted' : 'needs_consent'} />
                          </td>
                          <td>
                            <div className="flex gap-2">
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label={`Edit ${r.email}`}
                                onClick={() => {
                                  setEditing(r);
                                  form.reset({
                                    email: r.email,
                                    name: r.name,
                                    company: r.company,
                                    position: r.position,
                                  });
                                  setCustom(JSON.stringify(r.custom_fields, null, 2));
                                  setOpen(true);
                                }}
                              >
                                <Pencil size={15} />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label={`Consent for ${r.email}`}
                                onClick={() => {
                                  setConsent(r);
                                  setSource('');
                                }}
                              >
                                <ShieldCheck size={16} />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label={`Remove ${r.email}`}
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
                <Empty
                  title="Build your recipient library"
                  description="Add contacts manually or extract candidates from documents."
                />
              )}
              <Pagination data={d} page={page} setPage={setPage} />
            </>
          )}
        </QueryState>
      </section>
      <ConfirmDialog
        open={!!deleteTarget}
        itemLabel={deleteTarget?.email}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        onConfirm={() => { remove.mutate(deleteTarget.id); setDeleteTarget(null); }}
      />
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={editing ? 'Edit recipient' : 'Add recipient'}
      >
        <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="mt-5">
          {['email', 'name', 'company', 'position'].map((key) => (
            <Field
              key={key}
              label={key[0].toUpperCase() + key.slice(1)}
              error={form.formState.errors[key]}
            >
              <input {...form.register(key)} disabled={key === 'email' && !!editing} />
            </Field>
          ))}
          <Field label="Custom personalization fields (JSON object)">
            <textarea rows={3} value={custom} onChange={(e) => setCustom(e.target.value)} />
          </Field>
          <BusyButton busy={save.isPending} type="submit">
            Save recipient
          </BusyButton>
        </form>
      </Dialog>
      <Dialog
        open={!!consent}
        onOpenChange={() => setConsent(null)}
        title="Record recipient consent"
      >
        <p className="my-4">
          Consent must reflect a real permission or documented basis for contacting {consent?.email}
          .
        </p>
        <Field label="Source / evidence">
          <textarea
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder="e.g. Partnership inquiry form submitted on…"
          />
        </Field>
        <div className="flex gap-3">
          <BusyButton
            busy={recordConsent.isPending}
            disabled={source.length < 3}
            onClick={() => recordConsent.mutate(true)}
          >
            Record consent
          </BusyButton>
          <BusyButton
            variant="secondary"
            busy={recordConsent.isPending}
            disabled={source.length < 3}
            onClick={() => recordConsent.mutate(false)}
          >
            Revoke consent
          </BusyButton>
        </div>
      </Dialog>
    </>
  );
}
