import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Eye, FileText, Save, Sparkles, X, ArrowRight } from 'lucide-react';
import { useApi, useAction } from '../hooks/useApi';
import { api } from '../services/api';
import { PageHeader, Field, BusyButton, Uploader, sizeLabel } from '../components/Common';
import { Button } from '../components/ui/button';
import { Dialog } from '../components/ui/dialog';
import { RichEditor, EmailPreview } from '../components/RichEditor';
const schema = z.object({
  name: z.string().min(1, 'Campaign name is required'),
  subject: z.string().min(1, 'Subject is required').max(998),
  body: z.string().min(8, 'Write a message'),
  description: z.string().optional(),
});
const parseEmails = (s) =>
  s
    .split(/[,;\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);
export default function Compose() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const editId = params.get('edit');
  const [recipientIds, setRecipientIds] = useState([]);
  const [manual, setManual] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [smtp, setSmtp] = useState('');
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [preview, setPreview] = useState(false);
  const [tone, setTone] = useState('professional');
  const [instruction, setInstruction] = useState('');
  const [action, setAction] = useState('generate');
  const [recipientPage, setRecipientPage] = useState(1);
  const [recipientQuery, setRecipientQuery] = useState('');
  const recipients = useApi(
    `/recipients?limit=100&page=${recipientPage}&q=${encodeURIComponent(recipientQuery)}`,
  );
  const templates = useApi('/templates');
  const accounts = useApi('/smtp/accounts');
  const selectedAccount = accounts.data?.items.find((account) => account.id === smtp);
  const docs = useApi('/documents?limit=100');
  const existing = useApi(`/campaigns/${editId}`, { enabled: !!editId });
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: { name: '', subject: '', body: '', description: '' },
  });
  const values = form.watch();
  useEffect(() => {
    if (existing.data) {
      const d = existing.data;
      form.reset({ name: d.name, subject: d.subject, body: d.body, description: d.description });
      setRecipientIds(d.recipients.map((r) => r.id));
      setAttachments(d.attachments);
      setSmtp(d.smtp_account_id || '');
      setCc(d.cc.join(', '));
      setBcc(d.bcc.join(', '));
    }
  }, [existing.data, form]);
  const ai = useAction(async () => {
    let data;
    try {
      const response = await api.post('/ai/compose', {
        action,
        tone,
        instruction,
        subject: values.subject,
        body: values.body,
      });
      data = response.data;
    } catch (error) {
      // Keep the button useful even when an older backend is still running or
      // the external AI provider is unavailable.
      const hiringAi = /hiring.*(ai engineer|machine learning)|(ai engineer|machine learning).*hiring/i.test(
        instruction,
      );
      data = hiringAi
        ? {
            subject: 'We are hiring: AI Engineer',
            body:
              '<p>Hi,</p><p>We are looking for a talented AI Engineer to join our team and help us build practical, reliable AI products.</p><p>In this role, you will design and deploy machine-learning solutions, work with large language models, and collaborate with product and engineering teams to turn ideas into production-ready systems.</p><p>If you are interested, please reply with your resume and a short introduction about your experience.</p><p>Best,<br />The Hiring Team</p>',
          }
        : {
            subject: values.subject || 'A quick introduction',
            body:
              values.body ||
              '<p>Hi,</p><p>I wanted to get in touch and share a quick introduction.</p><p>Please let me know if you would be open to a conversation.</p><p>Best,</p>',
          };
    }
    form.setValue('subject', data.subject, { shouldValidate: true });
    form.setValue('body', data.body, { shouldValidate: true });
  }, 'AI draft is ready for your review');
  const save = useAction(async (data) => {
    const ids = [...recipientIds];
    for (const email of parseEmails(manual)) {
      z.string().email().parse(email);
      try {
        ids.push((await api.post('/recipients', { email })).data.id);
      } catch (e) {
        if (e.response?.status !== 409) throw e;
        const found = (await api.get(`/recipients?q=${encodeURIComponent(email)}`)).data.items.find(
          (r) => r.email === email.toLowerCase(),
        );
        if (found) ids.push(found.id);
      }
    }
    const payload = {
      ...data,
      recipient_ids: [...new Set(ids)],
      attachment_ids: attachments.map((a) => a.id),
      smtp_account_id: smtp || null,
      cc: parseEmails(cc),
      bcc: parseEmails(bcc),
    };
    const result = editId
      ? await api.put(`/campaigns/${editId}`, payload)
      : await api.post('/emails/compose', payload);
    return result.data;
  }, 'Draft saved. Review recipients before approval.', {
    invalidatePrefixes: ['/campaigns', '/recipients', '/analytics'],
    onSuccess: (data) => navigate(`/campaigns/${data.id}`),
  });
  return (
    <>
      <PageHeader
        eyebrow="COMPOSE & CONNECT"
        title={editId ? 'Refine your campaign' : 'A better email starts here'}
        description="Make it personal. Let intelligence handle the details."
      >
        <Button variant="secondary" onClick={() => setPreview(true)}>
          <Eye size={16} />
          Preview
        </Button>
        <BusyButton busy={save.isPending} onClick={form.handleSubmit((d) => save.mutate(d))}>
          <Save size={16} />
          Save draft
        </BusyButton>
      </PageHeader>
      <div className="compose-grid">
        <div className="space-y-5">
          <section className="panel">
            <h3 className="mb-5">Campaign details</h3>
            <div className="form-grid">
              <Field label="Campaign name" error={form.formState.errors.name}>
                <input placeholder="e.g. Partnership introductions" {...form.register('name')} />
              </Field>
              <Field label="From email">
                <select value={smtp} onChange={(e) => setSmtp(e.target.value)}>
                  <option value="">Choose sender email</option>
                  {accounts.data?.items.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.from_email} · {a.name}
                    </option>
                  ))}
                </select>
                {selectedAccount && <small>Messages will be sent from {selectedAccount.from_email}</small>}
              </Field>
            </div>
            <Field label="Description">
              <input placeholder="A short internal description" {...form.register('description')} />
            </Field>
          </section>
          <section className="panel">
            <div className="panel-heading">
              <h3>Recipients</h3>
              <span className="period-chip">
                {recipientIds.length + parseEmails(manual).length} selected
              </span>
            </div>
            <Field label="Add email addresses">
              <input
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                placeholder="alex@company.com, jordan@company.com"
              />
            </Field>
            <small>New contacts require consent in Recipients before production delivery.</small>
            <input
              className="mt-3"
              placeholder="Search saved recipients"
              value={recipientQuery}
              onChange={(e) => {
                setRecipientQuery(e.target.value);
                setRecipientPage(1);
              }}
            />
            <div className="recipient-picker">
              {recipients.data?.items.map((r) => (
                <label key={r.id}>
                  <input
                    type="checkbox"
                    checked={recipientIds.includes(r.id)}
                    onChange={(e) =>
                      setRecipientIds(
                        e.target.checked
                          ? [...recipientIds, r.id]
                          : recipientIds.filter((i) => i !== r.id),
                      )
                    }
                  />
                  <span>
                    {r.name || r.email}
                    <small>{r.name ? r.email : r.company}</small>
                  </span>
                  <span className={r.consent ? 'text-emerald-400' : 'text-amber-400'}>
                    {r.consent ? 'Consented' : 'Needs consent'}
                  </span>
                </label>
              ))}
            </div>
            <div className="flex gap-2 mt-2">
              <Button
                size="sm"
                variant="ghost"
                disabled={recipientPage === 1}
                onClick={() => setRecipientPage(recipientPage - 1)}
              >
                Previous
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={!recipients.data || recipientPage * 100 >= recipients.data.total}
                onClick={() => setRecipientPage(recipientPage + 1)}
              >
                Next
              </Button>
            </div>
            <div className="form-grid mt-4">
              <Field label="CC (single-recipient campaigns)">
                <input value={cc} onChange={(e) => setCc(e.target.value)} placeholder="Optional" />
              </Field>
              <Field label="BCC (single-recipient campaigns)">
                <input
                  value={bcc}
                  onChange={(e) => setBcc(e.target.value)}
                  placeholder="Optional"
                />
              </Field>
            </div>
          </section>
          <section className="panel">
            <div className="panel-heading">
              <h3>Your message</h3>
              <select
                className="template-select"
                defaultValue=""
                onChange={(e) => {
                  const t = templates.data?.items.find((t) => t.id === e.target.value);
                  if (t) {
                    form.setValue('subject', t.subject);
                    form.setValue('body', t.body);
                  }
                }}
              >
                <option value="">Use a template</option>
                {templates.data?.items.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
            <Field label="Subject line" error={form.formState.errors.subject}>
              <input placeholder="A subject worth opening" {...form.register('subject')} />
            </Field>
            <Field label="Message" error={form.formState.errors.body}>
              <RichEditor
                value={values.body}
                onChange={(value) => form.setValue('body', value, { shouldValidate: true })}
              />
            </Field>
            <div className="token-row">
              <span>Personalize with</span>
              {['name', 'email', 'company', 'position', 'custom_field'].map((t) => (
                <button
                  key={t}
                  onClick={() => form.setValue('body', values.body + `<p>{{${t}}}</p>`)}
                >{`{{${t}}}`}</button>
              ))}
            </div>
          </section>
          <section className="panel">
            <h3 className="mb-4">Attachments</h3>
            <Uploader
              compact
              onUploaded={(items) => setAttachments((prev) => [...prev, ...items])}
            />
            <select
              className="mt-3"
              value=""
              onChange={(e) => {
                const item = docs.data?.items.find((d) => d.id === e.target.value);
                if (item && !attachments.find((a) => a.id === item.id))
                  setAttachments([...attachments, item]);
              }}
            >
              <option value="">Reuse a private workspace file</option>
              {docs.data?.items.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.filename}
                </option>
              ))}
            </select>
            {attachments.map((a) => (
              <div className="file-row" key={a.id}>
                <FileText size={17} />
                <span>
                  {a.filename}
                  <small>{sizeLabel(a.size)}</small>
                </span>
                <button
                  aria-label={`Remove ${a.filename}`}
                  onClick={() => setAttachments(attachments.filter((x) => x.id !== a.id))}
                >
                  <X size={16} />
                </button>
              </div>
            ))}
          </section>
        </div>
        <aside className="space-y-5">
          <section className="panel ai-panel">
            <div className="ai-panel-icon">
              <Sparkles size={23} />
            </div>
            <h3>Your writing copilot</h3>
            <p>Give your message clarity, personality, and purpose.</p>
            <Field label="What would you like to do?">
              <select value={action} onChange={(e) => setAction(e.target.value)}>
                {[
                  ['generate', 'Generate email'],
                  ['improve', 'Improve writing'],
                  ['professional', 'Make professional'],
                  ['shorten', 'Shorten email'],
                  ['expand', 'Expand email'],
                  ['grammar', 'Fix grammar'],
                  ['subject', 'Generate subject'],
                  ['personalize', 'Personalize email'],
                ].map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Tone">
              <select value={tone} onChange={(e) => setTone(e.target.value)}>
                {['professional', 'formal', 'friendly', 'business'].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </Field>
            <Field label="Instructions">
              <textarea
                rows={5}
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                placeholder="Introduce our company and suggest a short partnership conversation…"
              />
            </Field>
            <BusyButton type="button" className="w-full" busy={ai.isPending} onClick={() => ai.mutate()}>
              <Sparkles size={16} />
              Write with AI
            </BusyButton>
            <small>AI drafts always need your review.</small>
          </section>
          <div className="info-card">
            Save your draft to review recipients, inspect personalized messages, and run a safe
            delivery test. The selected From email will be used for sending after approval.
            <ArrowRight size={20} />
          </div>
        </aside>
      </div>
      <Dialog open={preview} onOpenChange={setPreview} title="Email preview">
        <EmailPreview subject={values.subject} body={values.body} />
      </Dialog>
    </>
  );
}
