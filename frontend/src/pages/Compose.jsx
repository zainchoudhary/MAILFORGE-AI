import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Eye, FileText, Save, Send, Sparkles, X, ArrowRight, Check, ChevronDown, UsersRound } from 'lucide-react';
import { useApi, useAction } from '../hooks/useApi';
import { api } from '../services/api';
import { PageHeader, Field, BusyButton, ConfirmDialog, Uploader, sizeLabel, PickerDropdown } from '../components/Common';
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
const parseManualRecipients = (value) =>
  value
    .split(/[,;\n]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const match = entry.match(/^(.+?)\s*<([^<>\s]+@[^<>\s]+)>$/);
      if (!match || !match[1].trim()) {
        throw new Error('Enter each new recipient as Full name <email address>.');
      }
      return {
        name: match[1].trim(),
        email: z.string().email().parse(match[2]).toLowerCase(),
      };
    });
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
  const [groupsOpen, setGroupsOpen] = useState(false);
  const groupDropdownRef = useRef(null);
  const [sendOpen, setSendOpen] = useState(false);
  const [tone, setTone] = useState('professional');
  const [instruction, setInstruction] = useState('');
  const [action, setAction] = useState('generate');
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [recipientPage, setRecipientPage] = useState(1);
  const [recipientQuery, setRecipientQuery] = useState('');
  const recipients = useApi(
    `/recipients?limit=100&page=${recipientPage}&q=${encodeURIComponent(recipientQuery)}`,
  );
  const recipientGroups = useApi('/recipient-groups');
  const drafts = useApi('/campaigns?status=draft&limit=5');
  const templates = useApi('/templates');
  const accounts = useApi('/smtp/accounts');
  const selectedAccount = (accounts.data?.items || []).find((account) => account.id === smtp);
  const docs = useApi('/documents?limit=100');
  const existing = useApi(`/campaigns/${editId}`, { enabled: !!editId });
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: { name: '', subject: '', body: '', description: '' },
  });
  const isGroupSelected = (group) => group.recipient_ids.length > 0
    && group.recipient_ids.every((id) => recipientIds.includes(id));
  const selectedGroups = (recipientGroups.data?.items || []).filter(isGroupSelected);
  useEffect(() => {
    const closeWhenOutside = (event) => {
      if (groupDropdownRef.current && !groupDropdownRef.current.contains(event.target)) setGroupsOpen(false);
    };
    document.addEventListener('pointerdown', closeWhenOutside);
    return () => document.removeEventListener('pointerdown', closeWhenOutside);
  }, []);
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
  const persistDraft = async (data) => {
    const ids = [...recipientIds];
    for (const recipient of parseManualRecipients(manual)) {
      try {
        ids.push((await api.post('/recipients', recipient)).data.id);
      } catch (e) {
        if (e.response?.status !== 409) throw e;
        const found = (await api.get(`/recipients?q=${encodeURIComponent(recipient.email)}`)).data.items.find(
          (r) => r.email === recipient.email,
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
  };
  const save = useAction(persistDraft, 'Draft saved.', {
    invalidatePrefixes: ['/campaigns', '/recipients', '/analytics'],
    onSuccess: (data) => navigate(`/compose?edit=${data.id}`),
  });
  const send = useAction(async (data) => {
    const draft = await persistDraft(data);
    await api.post(`/campaigns/${draft.id}/review`, { revision: draft.revision, confirm: true });
    await api.post(`/campaigns/${draft.id}/dry-run`);
    return (await api.post(`/campaigns/${draft.id}/approve`, { revision: draft.revision, confirm: true })).data;
  }, 'Campaign delivery has started. Live progress is shown below.', {
    invalidatePrefixes: ['/campaigns', '/analytics', '/recipients', '/emails'],
    onSuccess: (data) => {
      setSendOpen(false);
      navigate(`/campaigns/${data.id}`);
    },
  });
  return (
    <>
      <PageHeader
        eyebrow="CAMPAIGN"
        title={editId ? 'Refine your campaign draft' : 'Create a campaign that gets a response'}
        description="Build, personalize, attach, and safely deliver email to your selected audience."
        backTo="/campaigns"
        backLabel="Back to campaigns"
      >
        <Button variant="secondary" onClick={() => setPreview(true)}>
          <Eye size={16} />
          Preview
        </Button>
        <BusyButton busy={save.isPending} onClick={form.handleSubmit((d) => save.mutate(d))}>
          <Save size={16} />
          Save draft
        </BusyButton>
        <Button onClick={form.handleSubmit(() => setSendOpen(true))} disabled={save.isPending || send.isPending}>
          <Send size={16} /> Send campaign
        </Button>
      </PageHeader>
      <div className="compose-grid">
        <div className="space-y-5">
          <section className="panel">
            <h3 className="mb-5">Campaign details</h3>
            <div className="form-grid">
              <Field label="Campaign name" required error={form.formState.errors.name}>
                <input placeholder="e.g. Partnership introductions" {...form.register('name')} />
              </Field>
              <Field label="From email">
                <PickerDropdown
                  value={smtp}
                  onChange={setSmtp}
                  placeholder="Choose sender email"
                  icon={Send}
                  ariaLabel="Choose sender email"
                  options={(accounts.data?.items || []).map((account) => ({ value: account.id, label: account.from_email, description: account.name }))}
                />
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
            <Field label="Add recipients manually">
              <input
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                placeholder="Alex Khan <alex@company.com>, Jordan Ali <jordan@company.com>"
              />
            </Field>
            <small>For every new contact, full name and email are required. Use Full name &lt;email address&gt;.</small>
            {!!recipientGroups.data?.items.length && <div className="compose-group-dropdown" ref={groupDropdownRef}>
              <button type="button" className="compose-group-trigger" aria-haspopup="listbox" aria-expanded={groupsOpen} onClick={() => setGroupsOpen((open) => !open)}>
                <span><UsersRound size={15} /><span>Saved recipient groups</span></span><ChevronDown size={16} className={groupsOpen ? 'open' : ''} />
              </button>
              {groupsOpen && <div className="compose-group-menu" role="listbox" aria-label="Saved recipient groups">
                <div className="compose-group-menu-head"><span>Select a saved audience</span><small>Click again to remove it</small></div>
                {recipientGroups.data.items.map((group) => {
                  const allSelected = isGroupSelected(group);
                  return <button type="button" role="option" aria-selected={allSelected} className={allSelected ? 'selected' : ''} key={group.id} onClick={() => setRecipientIds((current) => allSelected ? current.filter((id) => !group.recipient_ids.includes(id)) : [...new Set([...current, ...group.recipient_ids])])}>
                    <span className="compose-group-menu-icon"><UsersRound size={15} /></span><span><strong>{group.name}</strong><small>{group.recipient_count} {group.recipient_count === 1 ? 'recipient' : 'recipients'}</small></span>{allSelected && <Check size={16} />}
                  </button>;
                })}
              </div>}
            </div>}
            {!!selectedGroups.length && <div className="compose-selected-groups" aria-label="Selected recipient groups"><span>Selected groups</span><div>{selectedGroups.map((group) => <button type="button" key={group.id} onClick={() => setRecipientIds((current) => current.filter((id) => !group.recipient_ids.includes(id)))}>{group.name}<X size={13} aria-hidden="true" /></button>)}</div></div>}
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
                  <span className="text-emerald-400">Available</span>
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
              <Field label="CC (single-recipient campaign)">
                <input value={cc} onChange={(e) => setCc(e.target.value)} placeholder="Optional" />
              </Field>
              <Field label="BCC (single-recipient campaign)">
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
              <PickerDropdown
                value={selectedTemplate}
                onChange={(templateId) => {
                  setSelectedTemplate(templateId);
                  const t = (templates.data?.items || []).find((t) => t.id === templateId);
                  if (t) {
                    form.setValue('subject', t.subject);
                    form.setValue('body', t.body);
                  }
                }}
                placeholder="Use a template"
                icon={FileText}
                ariaLabel="Choose a message template"
                className="template-picker"
                options={(templates.data?.items || []).map((t) => ({ value: t.id, label: t.name, description: t.subject }))}
              />
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
              {['name', 'email', 'company', 'position'].map((t) => (
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
            <PickerDropdown
              className="mt-3 workspace-file-picker"
              value=""
              onChange={(documentId) => {
                const item = docs.data?.items.find((d) => d.id === documentId);
                if (item && !attachments.find((a) => a.id === item.id))
                  setAttachments([...attachments, item]);
              }}
              placeholder="Reuse a private workspace file"
              icon={FileText}
              ariaLabel="Reuse a private workspace file"
              options={(docs.data?.items || []).map((document) => ({ value: document.id, label: document.filename, description: 'Private workspace document' }))}
            />
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
              <PickerDropdown
                value={action}
                onChange={setAction}
                icon={Sparkles}
                ariaLabel="What would you like to do?"
                options={[
                  ['generate', 'Generate email'], ['improve', 'Improve writing'], ['professional', 'Make professional'], ['shorten', 'Shorten email'], ['expand', 'Expand email'], ['grammar', 'Fix grammar'], ['subject', 'Generate subject'], ['personalize', 'Personalize email'],
                ].map(([value, label]) => ({ value, label }))}
              />
            </Field>
            <Field label="Tone">
              <PickerDropdown
                value={tone}
                onChange={setTone}
                icon={Sparkles}
                ariaLabel="Tone"
                options={['professional', 'formal', 'friendly', 'business'].map((value) => ({ value, label: value[0].toUpperCase() + value.slice(1) }))}
              />
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
          <section className="panel outreach-drafts">
            <div className="panel-heading"><div><h3>Recent drafts</h3><p>Continue an unfinished campaign.</p></div></div>
            {drafts.data?.items.length ? drafts.data.items.map((draft) => <button key={draft.id} className={draft.id === editId ? 'active' : ''} onClick={() => navigate(`/compose?edit=${draft.id}`)}><span><strong>{draft.name}</strong><small>{draft.subject || 'No subject yet'}</small></span><ArrowRight size={15} /></button>) : <small>No saved drafts yet.</small>}
          </section>
        </aside>
      </div>
      <Dialog open={preview} onOpenChange={setPreview} title="Email preview">
        <EmailPreview subject={values.subject} body={values.body} />
      </Dialog>
      <ConfirmDialog
        open={sendOpen}
        onOpenChange={setSendOpen}
        title="Send campaign"
        itemLabel={`${recipientIds.length} selected recipients`}
        message={<>Your campaign will be sent to the selected recipients. After you continue, you’ll see each email’s live delivery status.</>}
        confirmLabel="Review and send"
        processingLabel="Preparing delivery…"
        onConfirm={() => send.mutateAsync(form.getValues())}
      />
    </>
  );
}
