import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowUpRight,
  Check,
  CheckCheck,
  Copy,
  Download,
  Eye,
  FileText,
  Pause,
  Play,
  Plus,
  Search,
  ShieldCheck,
  X,
  Trash2,
  CheckCircle2,
  Loader2,
} from 'lucide-react';
import { useApi, useAction } from '../hooks/useApi';
import { api, downloadFile } from '../services/api';
import {
  PageHeader,
  QueryState,
  Empty,
  Status,
  Pagination,
  BusyButton,
  dateLabel,
  ConfirmDialog,
  PickerDropdown,
} from '../components/Common';
import { Button } from '../components/ui/button';
import { Dialog } from '../components/ui/dialog';
import { EmailPreview } from '../components/RichEditor';
export default function Campaigns() {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const query = useApi(`/campaigns?page=${page}&q=${encodeURIComponent(q)}&status=${status}`, {
    refetchInterval: 10000,
  });
  const remove = useAction((id) => api.delete(`/campaigns/${id}`), 'Campaign deleted');
  return (
    <>
      <PageHeader
        eyebrow="EMAIL OPERATIONS"
        title="Campaigns"
        description="Meaningful outreach, managed from first draft to final event."
      >
        <Button asChild>
          <Link to="/compose">
            <Plus size={16} />
            New campaign
          </Link>
        </Button>
      </PageHeader>
      <section className="panel">
        <div className="filter-bar">
          <div className="search-input">
            <Search size={16} />
            <input
              placeholder="Search campaigns…"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <PickerDropdown
            ariaLabel="Filter campaigns by status"
            value={status}
            onChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
            placeholder="All statuses"
            options={[
              ['', 'All statuses', 'Show every campaign'],
              ['draft', 'Draft', 'Still being prepared'],
              ['scheduled', 'Scheduled', 'Ready for its send time'],
              ['processing', 'Processing', 'Preparing delivery'],
              ['sending', 'Sending', 'Delivery in progress'],
              ['paused', 'Paused', 'Delivery temporarily stopped'],
              ['completed', 'Completed', 'Delivery finished'],
              ['partially_completed', 'Partially completed', 'Delivery finished with issues'],
              ['failed', 'Failed', 'Needs attention'],
              ['cancelled', 'Cancelled', 'Delivery was stopped'],
            ].map(([value, label, description]) => ({ value, label, description }))}
          />
          {(q || status) && <Button variant="ghost" size="sm" onClick={() => { setQ(''); setStatus(''); setPage(1); }}>Clear filters</Button>}
        </div>
        <QueryState query={query}>
          {(d) => (
            <>
              {d.items.length ? (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Campaign</th>
                        <th>Status</th>
                        <th>Created</th>
                        <th>Scheduled</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {d.items.map((c) => (
                        <tr key={c.id}>
                          <td>
                            <Link className="table-title" to={`/campaigns/${c.id}`}>
                              {c.name}
                            </Link>
                            <small>{c.subject}</small>
                          </td>
                          <td>
                            <Status value={c.status} />
                          </td>
                          <td>{dateLabel(c.created_at)}</td>
                          <td>{dateLabel(c.scheduled_at)}</td>
                          <td>
                            <div className="flex gap-2">
                              <Link to={`/campaigns/${c.id}`} aria-label={`Open ${c.name}`}>
                                <ArrowUpRight size={18} />
                              </Link>
                              <button
                                aria-label={`Delete ${c.name}`}
                                onClick={() => {
                                  setDeleteTarget(c);
                                }}
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty
                  title="No campaigns found"
                  description="Create a draft to begin a reviewable, traceable campaign."
                />
              )}
              <Pagination data={d} page={page} setPage={setPage} />
            </>
          )}
        </QueryState>
      </section>
      <ConfirmDialog
        open={!!deleteTarget}
        itemLabel={deleteTarget?.name}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        onConfirm={() => remove.mutateAsync(deleteTarget.id)}
      />
    </>
  );
}
export function CampaignDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const query = useApi(`/campaigns/${id}`, { refetchInterval: 2000 });
  const previews = useApi(`/campaigns/${id}/preview`);
  const templates = useApi('/templates');
  const me = useApi('/auth/me');
  const [preview, setPreview] = useState(null);
  const [approval, setApproval] = useState(false);
  const [approved, setApproved] = useState(false);
  const [result, setResult] = useState(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [testSent, setTestSent] = useState(false);
  const [approvalStarting, setApprovalStarting] = useState(false);
  useEffect(() => {
    if (query.data?.status && query.data.status !== 'draft') setApprovalStarting(false);
  }, [query.data?.status]);
  const action = useAction(async (name) => {
    const { data } = await api.post(
      `/campaigns/${id}/${name}`,
      ['review', 'approve'].includes(name)
        ? { revision: query.data.revision, confirm: true }
        : undefined,
    );
    if (name === 'dry-run') setResult(data);
    if (name === 'duplicate') navigate(`/campaigns/${data.id}`);
  }, 'Campaign updated', {
    onSuccess: () => setApproval(false),
    onError: () => setApprovalStarting(false),
  });
  const test = useAction(
    () => api.post('/emails/send-test', { campaign_id: id, recipient: me.data.email }),
    'Test request recorded; inspect the test campaign for its outcome',
  );
  const exportAction = useAction(
    () => downloadFile(`/campaigns/${id}/report`, `${query.data.name}.csv`),
    'Report downloaded',
  );
  const assign = useAction(async ({ recipientId, templateId }) => {
    const c = query.data;
    await api.put(`/campaigns/${id}`, {
      name: c.name,
      description: c.description,
      subject: c.subject,
      body: c.body,
      smtp_account_id: c.smtp_account_id,
      cc: c.cc,
      bcc: c.bcc,
      scheduled_at: c.scheduled_at,
      recipient_ids: c.recipients.map((r) => r.id),
      attachment_ids: c.attachments.map((a) => a.id),
      recipient_templates: Object.fromEntries(
        c.recipients
          .map((r) => [r.id, r.id === recipientId ? templateId : r.template_id])
          .filter(([, t]) => t),
      ),
    });
  }, 'Recipient template updated; review and dry-run again');
  return (
    <QueryState query={query}>
      {(c) => (
        <>
          <PageHeader
            eyebrow="CAMPAIGN WORKSPACE"
            title={c.name}
            description={c.description || c.subject}
            backTo="/campaigns"
            backLabel="Back to campaigns"
          >
            <Status value={c.status} />
            <Button variant="secondary" onClick={() => action.mutate('duplicate')}>
              <Copy size={15} />
              Duplicate
            </Button>
            <Button variant="secondary" onClick={() => exportAction.mutate()}>
              <Download size={15} />
              Report
            </Button>
            {c.status === 'draft' && (
              <Button asChild>
                <Link to={`/compose?edit=${id}`}>Edit draft</Link>
              </Button>
            )}
          </PageHeader>
          <div className="stat-grid">
            {[
              ['Selected recipients', c.recipients.length],
              [
                'Emails sent',
                (c.counts.smtp_accepted || 0) +
                  (c.counts.delivered || 0) +
                  (c.counts.opened || 0) +
                  (c.counts.clicked || 0),
              ],
              ['Pending', (c.counts.queued || 0) + (c.counts.sending || 0)],
              ['Failed / uncertain', (c.counts.failed || 0) + (c.counts.uncertain || 0)],
            ].map(([l, v]) => (
              <div className="stat-card" key={l}>
                <span>{l}</span>
                <strong>{v}</strong>
              </div>
            ))}
          </div>
          {['processing', 'sending'].includes(c.status) && (
            <section className="panel sending-banner mt-6" aria-live="polite">
              <div className="delivery-ring" aria-label="Sending in progress">
                <svg viewBox="0 0 44 44" role="img">
                  <circle className="delivery-ring-track" cx="22" cy="22" r="18" />
                  <circle
                    className="delivery-ring-progress"
                    cx="22"
                    cy="22"
                    r="18"
                    style={{
                      strokeDashoffset: 113 - (113 * Math.min(100, (((c.counts.smtp_accepted || 0) + (c.counts.delivered || 0) + (c.counts.opened || 0) + (c.counts.clicked || 0)) / Math.max(1, c.recipients.length)) * 100)) / 100,
                    }}
                  />
                </svg>
                <strong>{Math.round(Math.min(100, (((c.counts.smtp_accepted || 0) + (c.counts.delivered || 0) + (c.counts.opened || 0) + (c.counts.clicked || 0)) / Math.max(1, c.recipients.length)) * 100))}%</strong>
              </div>
              <div className="sending-banner-copy">
                <strong>Email delivery in progress</strong>
                <p>
                  {(c.counts.smtp_accepted || 0) + (c.counts.delivered || 0) + (c.counts.opened || 0) + (c.counts.clicked || 0)} of {c.recipients.length} emails accepted. This page updates automatically.
                </p>
                <div className="sending-progress" aria-label="Email delivery progress">
                  <span
                    style={{
                      width: `${Math.min(100, (((c.counts.smtp_accepted || 0) + (c.counts.delivered || 0) + (c.counts.opened || 0) + (c.counts.clicked || 0)) / Math.max(1, c.recipients.length)) * 100)}%`,
                    }}
                  />
                </div>
              </div>
            </section>
          )}
          {['completed', 'partially_completed'].includes(c.status) && (
            <section className="panel delivery-complete-banner mt-6" aria-live="polite">
              <CheckCircle2 size={23} />
              <div>
                <strong>{c.status === 'completed' ? 'Email delivery completed' : 'Email delivery finished with some issues'}</strong>
                <p>Final delivery results are ready below. You can download the report for a complete record.</p>
              </div>
            </section>
          )}
          <div className="compose-grid">
            <div className="space-y-5">
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h3>{c.status === 'draft' ? 'Recipient review' : 'Campaign participants'}</h3>
                    <p>{c.status === 'draft' ? 'Only selected, active recipients can be approved.' : 'Every delivery recipient is retained here, including historical contact snapshots.'}</p>
                  </div>
                  <span className="period-chip">Revision {c.revision}</span>
                </div>
                {c.recipients.length ? (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Recipient</th>
                          <th>Template</th>
                          <th>Eligibility</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {c.recipients.map((r) => (
                          <tr key={r.id}>
                            <td>
                              <strong>{r.name || r.email}</strong>
                              <small>{r.email}</small>
                            </td>
                            <td>
                              {c.status === 'draft' ? (
                                <select
                                  aria-label={`Template for ${r.email}`}
                                  value={r.template_id || ''}
                                  disabled={assign.isPending}
                                  onChange={(e) =>
                                    assign.mutate({ recipientId: r.id, templateId: e.target.value })
                                  }
                                >
                                  <option value="">Campaign message</option>
                                  {templates.data?.items.map((t) => (
                                    <option key={t.id} value={t.id}>
                                      {t.name}
                                    </option>
                                  ))}
                                </select>
                              ) : r.template_id ? (
                                'Custom template'
                              ) : (
                                'Campaign message'
                              )}
                            </td>
                            <td>
                              {r.historical ? (
                                <span className="period-chip">Delivery snapshot · {r.delivery_status}</span>
                              ) : (
                                <Status
                                  value={
                                    previews.data?.items.find((p) => p.recipient_id === r.id)
                                      ?.eligible
                                      ? 'ready'
                                      : 'unavailable'
                                  }
                                />
                              )}
                            </td>
                            <td>
                              <Button
                                size="icon"
                                variant="ghost"
                                aria-label={`Preview ${r.email}`}
                                disabled={r.historical}
                                title={r.historical ? 'This recipient was removed from the live library' : 'Preview message'}
                                onClick={() =>
                                  setPreview(
                                    previews.data?.items.find((p) => p.recipient_id === r.id),
                                  )
                                }
                              >
                                <Eye size={16} />
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Empty
                    title="No recipients selected"
                    description="Edit the draft to choose recipients."
                  />
                )}
                {previews.isError && (
                  <p className="text-red-400">{previews.error.response?.data?.detail}</p>
                )}
              </section>
              <section className="panel">
                <h3 className="mb-4">Campaign message</h3>
                <EmailPreview subject={c.subject} body={c.body} />
                {c.attachments.map((a) => (
                  <div className="file-row" key={a.id}>
                    <FileText size={16} />
                    {a.filename}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => downloadFile(`/documents/${a.id}/download`, a.filename)}
                    >
                      Download
                    </Button>
                  </div>
                ))}
              </section>
              <Button variant="secondary" asChild>
                <Link to={`/activity?campaign=${id}`}>
                  Inspect individual messages <ArrowUpRight size={15} />
                </Link>
              </Button>
            </div>
            <aside className="space-y-5">
              <section className="panel approval-panel">
                <ShieldCheck className="text-cyan-300 mb-4" size={28} />
                <h3>Controlled delivery</h3>
                <p>Review. Test. Approve. Every step is recorded.</p>
                {c.status === 'draft' && (
                  <>
                  <div className="approval-actions mt-5">
                    <button
                      type="button"
                      className="approval-step approval-step-action"
                      disabled={c.reviewed_revision === c.revision || (action.isPending && action.variables === 'review')}
                      onClick={() => action.mutate('review')}
                    >
                      <span className={c.reviewed_revision === c.revision ? 'done' : ''}>
                        {action.isPending && action.variables === 'review' ? <Loader2 className="animate-spin" size={15} /> : c.reviewed_revision === c.revision ? <Check size={15} /> : 1}
                      </span>
                      <div><strong>Confirm recipient review</strong><small>Click the circle to confirm</small></div>
                    </button>
                    <button
                      type="button"
                      className="approval-step approval-step-action"
                      disabled={c.reviewed_revision !== c.revision || c.dry_run_revision === c.revision || (action.isPending && action.variables === 'dry-run')}
                      onClick={() => action.mutate('dry-run')}
                    >
                      <span className={c.dry_run_revision === c.revision ? 'done' : ''}>
                        {action.isPending && action.variables === 'dry-run' ? <Loader2 className="animate-spin" size={15} /> : c.dry_run_revision === c.revision ? <Check size={15} /> : 2}
                      </span>
                      <div><strong>Run safe test</strong><small>Validate without sending</small></div>
                    </button>
                    <button
                      type="button"
                      className="approval-step approval-step-action"
                      disabled={c.dry_run_revision !== c.revision || testSent || test.isPending}
                      onClick={() => test.mutate(undefined, { onSuccess: () => setTestSent(true) })}
                    >
                      <span className={testSent ? 'done' : ''}>
                        {test.isPending ? <Loader2 className="animate-spin" size={15} /> : testSent ? <Check size={15} /> : 3}
                      </span>
                      <div><strong>Send test to my account</strong><small>{testSent ? 'Test completed' : 'Optional final check'}</small></div>
                    </button>
                  </div>
                  <div className="space-y-3 mt-5">
                    <Button
                      className="w-full"
                      disabled={approvalStarting || c.reviewed_revision !== c.revision || c.dry_run_revision !== c.revision}
                      onClick={() => {
                        setApproved(false);
                        setApproval(true);
                      }}
                    >
                      Approve campaign <ArrowUpRight size={15} />
                    </Button>
                  </div>
                  </>
                )}
                {['processing', 'sending', 'scheduled'].includes(c.status) && (
                  <Button className="w-full mt-4" onClick={() => action.mutate('pause')}>
                    <Pause size={16} />
                    Pause
                  </Button>
                )}
                {c.status === 'paused' && (
                  <Button onClick={() => action.mutate('resume')}>
                    <Play size={16} />
                    Resume
                  </Button>
                )}
                {['failed', 'partially_completed'].includes(c.status) && (
                  <Button onClick={() => action.mutate('retry')}>Retry eligible failures</Button>
                )}
                {['draft', 'processing', 'sending', 'scheduled', 'paused'].includes(c.status) && (
                  <Button
                    className="w-full mt-3"
                    variant="ghost"
                    onClick={() => {
                      setCancelOpen(true);
                    }}
                  >
                    Cancel campaign
                  </Button>
                )}
                <small className="block mt-4">
                  Pause and cancel stop queued messages. In-flight SMTP transactions may complete.
                </small>
              </section>
              <section className="panel">
                <h3>Timeline</h3>
                {[
                  ['Created', c.created_at],
                  ['Approved', c.approved_at],
                  ['Scheduled', c.scheduled_at],
                  ['Started', c.started_at],
                  ['Completed', c.completed_at],
                ].map(([l, v]) => (
                  <div className="timeline-row" key={l}>
                    <span>{l}</span>
                    <small>{dateLabel(v)}</small>
                  </div>
                ))}
              </section>
              {result && (
                <section className="panel">
                  <Status value="dry_run" />
                  <p className="mt-3">
                    {result.items.length} personalized messages validated. Zero emails sent.
                  </p>
                  {result.warnings.map((w) => (
                    <p key={w} className="text-amber-300">
                      {w}
                    </p>
                  ))}
                </section>
              )}
            </aside>
          </div>
          <Dialog open={!!preview} onOpenChange={() => setPreview(null)} title="Personalized email">
            {preview && (
              <EmailPreview
                subject={preview.subject}
                body={preview.body}
                recipient={preview.email}
              />
            )}
          </Dialog>
          <Dialog open={approval} onOpenChange={setApproval} busy={action.isPending} title="Approve production delivery">
            <p className="my-5">
              This authorizes delivery to {c.recipients.length} selected recipients. The server will
              enforce recipient availability, suppression, SMTP, and dry-run checks.
            </p>
            <label className="check-label">
              <input
                type="checkbox"
                checked={approved}
                onChange={(e) => setApproved(e.target.checked)}
              />
              I reviewed the recipients and messages and approve this campaign.
            </label>
            <BusyButton
              className="mt-5"
              busy={action.isPending}
              disabled={!approved}
              onClick={() => {
                setApprovalStarting(true);
                action.mutate('approve');
              }}
            >
              {approvalStarting || action.isPending ? 'Processing…' : 'Approve and queue'}
            </BusyButton>
          </Dialog>
          <ConfirmDialog
            open={cancelOpen}
            onOpenChange={setCancelOpen}
            title="Cancel campaign delivery"
            confirmLabel="Cancel delivery"
            message="Cancel queued delivery? Messages already being sent cannot be recalled."
            onConfirm={() => action.mutateAsync('cancel')}
          />
        </>
      )}
    </QueryState>
  );
}
