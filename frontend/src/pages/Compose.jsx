import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Eye, FileText, Save, Send, Sparkles, X, ArrowRight, Check, ChevronDown, UsersRound, Search, Mail, Building2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useApi, useAction } from '../hooks/useApi';
import { api } from '../services/api';
import { PageHeader, Field, BusyButton, ConfirmDialog, Empty, Uploader, sizeLabel, PickerDropdown } from '../components/Common';
import { Button } from '../components/ui/button';
import { Dialog } from '../components/ui/dialog';
import { RichEditor, EmailPreview } from '../components/RichEditor';
import { FilePreview } from '../components/FilePreview';
import { getGroupPreviewMembers } from '../services/recipientGroups';
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

function ComposeSection({ title, open, onToggle, badge, children }) {
  return (
    <section className={`panel compose-section${open ? '' : ' is-collapsed'}`}>
      <button
        type="button"
        className="compose-section-toggle"
        aria-expanded={open}
        onClick={onToggle}
      >
        <span className="compose-section-heading">
          <h3>{title}</h3>
          {badge}
        </span>
        <ChevronDown size={18} className={open ? 'open' : ''} aria-hidden="true" />
      </button>
      {open ? <div className="compose-section-body">{children}</div> : null}
    </section>
  );
}

export default function Compose() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const editId = params.get('edit');
  useEffect(() => {
    // Warm the campaign detail chunk so post-send navigation is not waiting on download.
    void import('./Campaigns');
  }, []);
  const [recipientIds, setRecipientIds] = useState([]);
  const [manual, setManual] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [smtp, setSmtp] = useState('');
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [preview, setPreview] = useState(false);
  const [previewFile, setPreviewFile] = useState(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [groupsOpen, setGroupsOpen] = useState(false);
  const [groupSearch, setGroupSearch] = useState('');
  const [previewGroup, setPreviewGroup] = useState(null);
  const groupDropdownRef = useRef(null);
  const [sendOpen, setSendOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [autosaveStatus, setAutosaveStatus] = useState('');
  const [recoveryReady, setRecoveryReady] = useState(Boolean(editId));
  const [openSections, setOpenSections] = useState({
    details: true,
    recipients: true,
    message: true,
    attachments: true,
  });
  const toggleSection = (key) => setOpenSections((current) => ({ ...current, [key]: !current[key] }));
  const autosaveInFlight = useRef(false);
  const recipients = useApi('/recipients?limit=100');
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
  // Group members stay under the group chip/popup — Selected recipients only
  // lists people picked individually outside of any currently selected group.
  const selectedGroupMemberIds = new Set(selectedGroups.flatMap((group) => group.recipient_ids || []));
  const selectedRecipients = (recipients.data?.items || []).filter(
    (recipient) => recipientIds.includes(recipient.id) && !selectedGroupMemberIds.has(recipient.id),
  );
  const visibleGroups = (recipientGroups.data?.items || []).filter((group) => group.name.toLowerCase().includes(groupSearch.trim().toLowerCase()));
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
    const { data } = await api.post('/ai/compose', {
      action: 'generate',
      tone: 'professional',
      instruction: instruction.trim(),
      subject: values.subject,
      body: values.body,
    });
    const refusal = data.refusal_message || 'You can only ask AI to write emails.';
    const plainBody = String(data.body || '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    const looksLikeRefusal =
      data.in_scope === false ||
      plainBody.includes('only ask ai to write emails') ||
      plainBody.includes('only help with writing or improving this email');
    if (looksLikeRefusal) {
      toast.error(refusal);
      return { refused: true };
    }
    if (data.subject) form.setValue('subject', data.subject, { shouldValidate: true });
    if (data.body) form.setValue('body', data.body, { shouldValidate: true });
    setAiOpen(false);
    setInstruction('');
    return data;
  }, (data) => (data?.refused ? '' : 'AI draft is ready for your review'));
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
  useEffect(() => {
    if (editId || existing.isPending || existing.data) {
      setRecoveryReady(true);
      return;
    }
    try {
      const saved = JSON.parse(localStorage.getItem('outreach-studio:compose-recovery') || 'null');
      if (saved?.values) {
        form.reset(saved.values);
        setRecipientIds(saved.recipientIds || []);
        setManual(saved.manual || '');
        setAttachments(saved.attachments || []);
        setSmtp(saved.smtp || '');
        setCc(saved.cc || '');
        setBcc(saved.bcc || '');
        setSelectedTemplate(saved.selectedTemplate || '');
        setAutosaveStatus('Recovered your unsaved draft');
      }
    } catch {
      // Ignore an invalid old browser recovery record.
    } finally {
      setRecoveryReady(true);
    }
  }, [editId, existing.data, existing.isPending, form]);
  useEffect(() => {
    if (!recoveryReady || existing.isPending) return undefined;
    const snapshot = {
      values,
      recipientIds,
      manual,
      attachments,
      smtp,
      cc,
      bcc,
      selectedTemplate,
    };
    try {
      localStorage.setItem('outreach-studio:compose-recovery', JSON.stringify(snapshot));
    } catch {
      // Browser storage is only a recovery aid; campaign persistence remains server-backed.
    }
    if (!schema.safeParse(values).success) {
      setAutosaveStatus('Saved locally while you finish the required fields');
      return undefined;
    }
    const timer = window.setTimeout(async () => {
      if (autosaveInFlight.current) return;
      autosaveInFlight.current = true;
      setAutosaveStatus('Saving automatically…');
      try {
        const saved = await persistDraft(values);
        setAutosaveStatus('Saved automatically');
        if (!editId) navigate(`/compose?edit=${saved.id}`, { replace: true });
      } catch {
        setAutosaveStatus('Changes are safe here — automatic save will retry after your next edit');
      } finally {
        autosaveInFlight.current = false;
      }
    }, 800);
    return () => window.clearTimeout(timer);
  }, [attachments, bcc, cc, editId, existing.isPending, manual, navigate, recipientIds, recoveryReady, selectedTemplate, smtp, values]);
  const save = useAction(persistDraft, 'Draft saved.', {
    invalidatePrefixes: ['/campaigns', '/recipients', '/analytics'],
    onSuccess: (data) => navigate(`/compose?edit=${data.id}`),
  });
  const send = useAction(async (data) => {
    const draft = await persistDraft(data);
    return (
      await api.post(`/campaigns/${draft.id}/approve`, {
        revision: draft.revision,
        confirm: true,
      })
    ).data;
  }, '', {
    invalidatePrefixes: ['/campaigns', '/analytics', '/recipients', '/emails'],
    awaitRefetch: false,
    onSuccess: (data) => {
      setSendOpen(false);
      // Approval returns a compact campaign record. Let CampaignDetail fetch
      // its complete shape instead of briefly rendering this partial payload.
      queryClient.removeQueries({ queryKey: [`/campaigns/${data.id}`], exact: true });
      sessionStorage.setItem(`mf_delivery_toast_${data.id}`, '1');
      navigate(`/campaigns/${data.id}`, { replace: true });
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
        {autosaveStatus && <span className="compose-autosave-status" role="status">{autosaveStatus}</span>}
        <Button
          onClick={form.handleSubmit(() => {
            const account = (accounts.data?.items || []).find((item) => item.id === smtp);
            if (!smtp || !account?.tested_at) {
              toast.error('Select a tested SMTP account');
              return;
            }
            setSendOpen(true);
          })}
          disabled={save.isPending || send.isPending}
        >
          <Send size={16} /> Send campaign
        </Button>
      </PageHeader>
      <div className="compose-grid">
        <div className="space-y-5">
          <ComposeSection
            title="Campaign details"
            open={openSections.details}
            onToggle={() => toggleSection('details')}
          >
            <div className="form-grid">
              <Field label="Campaign name" required error={form.formState.errors.name}>
                <input placeholder="e.g. Partnership introductions" {...form.register('name')} />
              </Field>
              <Field label="From email">
                <PickerDropdown
                  searchable
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
          </ComposeSection>
          <ComposeSection
            title="Recipients"
            open={openSections.recipients}
            onToggle={() => toggleSection('recipients')}
            badge={(
              <span className="period-chip">
                {recipientIds.length + parseEmails(manual).length} selected
              </span>
            )}
          >
            <Field label="Add recipients manually">
              <input
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                placeholder="Alex Khan <alex@company.com>, Jordan Ali <jordan@company.com>"
              />
            </Field>
            <small>For every new contact, full name and email are required. Use Full name &lt;email address&gt;.</small>
            <div className="compose-audience-selectors">
              <PickerDropdown
                searchable
                value=""
                onChange={(recipientId) => setRecipientIds((current) => current.includes(recipientId) ? current : [...current, recipientId])}
                placeholder="Add saved recipient"
                icon={UsersRound}
                ariaLabel="Add saved recipient"
                searchPlaceholder="Search recipients"
                options={(recipients.data?.items || []).filter((recipient) => !recipientIds.includes(recipient.id)).map((recipient) => ({ value: recipient.id, label: recipient.name || recipient.email, description: recipient.name ? recipient.email : [recipient.company, recipient.position].filter(Boolean).join(' · '), searchTerms: [recipient.email, recipient.company, recipient.position] }))}
              />
              <div className="compose-group-dropdown" ref={groupDropdownRef}>
                <button
                  type="button"
                  className="compose-group-trigger"
                  aria-haspopup="listbox"
                  aria-expanded={groupsOpen}
                  onClick={() => setGroupsOpen((open) => !open)}
                >
                  <span>
                    <UsersRound size={15} />
                    <span>Saved recipient groups</span>
                  </span>
                  <ChevronDown size={16} className={groupsOpen ? 'open' : ''} />
                </button>
                {groupsOpen && (
                  <div className="compose-group-menu" role="listbox" aria-label="Saved recipient groups">
                    <label className="picker-dropdown-search">
                      <Search size={14} />
                      <input
                        autoFocus
                        type="search"
                        value={groupSearch}
                        onChange={(event) => setGroupSearch(event.target.value)}
                        placeholder="Search groups"
                        aria-label="Search groups"
                      />
                    </label>
                    <div className="compose-group-options">
                      {recipientGroups.isPending && (
                        <p className="picker-dropdown-empty" role="status">
                          Loading saved groups…
                        </p>
                      )}
                      {!recipientGroups.isPending &&
                        visibleGroups.map((group) => {
                          const allSelected = isGroupSelected(group);
                          return (
                            <button
                              type="button"
                              role="option"
                              aria-selected={allSelected}
                              className={allSelected ? 'selected' : ''}
                              key={group.id}
                              onClick={() =>
                                setRecipientIds((current) =>
                                  allSelected
                                    ? current.filter((id) => !group.recipient_ids.includes(id))
                                    : [...new Set([...current, ...group.recipient_ids])],
                                )
                              }
                            >
                              <span>
                                <strong>{group.name}</strong>
                                <small>
                                  {group.recipient_count}{' '}
                                  {group.recipient_count === 1 ? 'recipient' : 'recipients'}
                                </small>
                              </span>
                              {allSelected && <Check size={16} />}
                            </button>
                          );
                        })}
                      {!recipientGroups.isPending && !visibleGroups.length && (
                        <p className="picker-dropdown-empty" role="status">
                          {recipientGroups.isError
                            ? 'Saved groups could not load. Try again in a moment.'
                            : 'No matching groups'}
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
            {!!selectedGroups.length && (
              <div className="compose-selected-groups" aria-label="Selected recipient groups">
                <span>Selected groups</span>
                <div>
                  {selectedGroups.map((group) => (
                    <span className="compose-selected-group-chip" key={group.id}>
                      <button type="button" title={group.name} onClick={() => setPreviewGroup(group)} aria-label={`Preview ${group.name}`}>
                        {group.name}
                      </button>
                      <button
                        type="button"
                        className="compose-selected-group-remove"
                        aria-label={`Remove ${group.name}`}
                        onClick={() => setRecipientIds((current) => current.filter((id) => !group.recipient_ids.includes(id)))}
                      >
                        <X size={13} aria-hidden="true" />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}
            {!!selectedRecipients.length && <div className="compose-selected-recipients" aria-label="Selected saved recipients"><span>Selected recipients</span><div>{selectedRecipients.map((recipient) => <button type="button" key={recipient.id} onClick={() => setRecipientIds((current) => current.filter((id) => id !== recipient.id))}>{recipient.name || recipient.email}<X size={13} aria-hidden="true" /></button>)}</div></div>}
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
          </ComposeSection>
          <ComposeSection
            title="Your message"
            open={openSections.message}
            onToggle={() => toggleSection('message')}
          >
            <div className="compose-message-tools compose-section-tools">
              <PickerDropdown
                searchable
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
              <Button
                type="button"
                variant="secondary"
                className="compose-ai-trigger"
                onClick={() => setAiOpen(true)}
              >
                <Sparkles size={15} />
                Write with AI
              </Button>
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
          </ComposeSection>
          <ComposeSection
            title="Attachments"
            open={openSections.attachments}
            onToggle={() => toggleSection('attachments')}
            badge={attachments.length ? <span className="period-chip">{attachments.length} added</span> : null}
          >
            <Uploader
              compact
              onUploaded={(items) => setAttachments((prev) => [...prev, ...items])}
            />
            <PickerDropdown
              searchable
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
                  <button type="button" className="table-title" onClick={() => setPreviewFile(a)}>
                    {a.filename}
                  </button>
                  <small>{sizeLabel(a.size)}</small>
                </span>
                <Button type="button" size="sm" variant="ghost" onClick={() => setPreviewFile(a)}>
                  <Eye size={14} /> Preview
                </Button>
                <button
                  aria-label={`Remove ${a.filename}`}
                  onClick={() => setAttachments(attachments.filter((x) => x.id !== a.id))}
                >
                  <X size={16} />
                </button>
              </div>
            ))}
          </ComposeSection>
        </div>
        <aside className="space-y-5">
          <section className="panel outreach-drafts">
            <div className="panel-heading"><div><h3>Recent drafts</h3><p>Continue an unfinished campaign.</p></div></div>
            {drafts.data?.items.length ? drafts.data.items.map((draft) => <button key={draft.id} className={draft.id === editId ? 'active' : ''} onClick={() => navigate(`/compose?edit=${draft.id}`)}><span><strong>{draft.name}</strong><small>{draft.subject || 'No subject yet'}</small></span><ArrowRight size={15} /></button>) : <small>No saved drafts yet.</small>}
          </section>
        </aside>
      </div>
      <Dialog open={preview} onOpenChange={setPreview} title="Email preview">
        <EmailPreview subject={values.subject} body={values.body} />
      </Dialog>
      <Dialog
        open={aiOpen}
        onOpenChange={setAiOpen}
        title="Write with AI"
        description="Describe the email you want. AI only writes email copy for this campaign."
      >
        <div className="compose-ai-dialog">
          <Field label="Instructions">
            <textarea
              rows={5}
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="e.g. Write a short partnership introduction and suggest a 15-minute call…"
            />
          </Field>
          <div className="dialog-actions">
            <Button type="button" variant="secondary" disabled={ai.isPending} onClick={() => setAiOpen(false)}>
              Cancel
            </Button>
            <BusyButton type="button" busy={ai.isPending} onClick={() => ai.mutate()}>
              <Sparkles size={16} />
              Generate email
            </BusyButton>
          </div>
        </div>
      </Dialog>
      <Dialog
        open={!!previewGroup}
        onOpenChange={(value) => !value && setPreviewGroup(null)}
        title={previewGroup ? `${previewGroup.name} members` : 'Recipient group preview'}
        description="A read-only view of the people in this saved recipient group."
      >
        <div className="group-preview" aria-label="Recipient group members">
          <div className="group-preview-summary">
            <span><UsersRound size={16} /></span>
            <div>
              <strong>{previewGroup?.recipient_count || 0} saved members</strong>
              <small>Member details are private to this workspace.</small>
            </div>
          </div>
          {(() => {
            const members = getGroupPreviewMembers(previewGroup);
            return members.length ? (
              <div className="group-preview-members">
                {members.map((member) => (
                  <article key={member.id}>
                    <span className="group-recipient-avatar">{(member.name || member.email).slice(0, 1).toUpperCase()}</span>
                    <div>
                      <strong>{member.name || member.email}</strong>
                      <small><Mail size={12} /> {member.email}</small>
                      {(member.company || member.position) && (
                        <small><Building2 size={12} /> {[member.company, member.position].filter(Boolean).join(' · ')}</small>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <Empty title="No members available" description="This group has no active recipients to preview." />
            );
          })()}
        </div>
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
      <FilePreview document={previewFile} onClose={() => setPreviewFile(null)} />
    </>
  );
}
