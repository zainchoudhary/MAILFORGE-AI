import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowUpRight,
  CheckCheck,
  Copy,
  Download,
  Eye,
  FileText,
  Plus,
  Search,
  Send,
  X,
  Trash2,
  CheckCircle2,
} from 'lucide-react';
import { toast } from 'sonner';
import { useApi, useAction } from '../hooks/useApi';
import { api, downloadFile } from '../services/api';
import {
  PageHeader,
  QueryState,
  Empty,
  Status,
  Pagination,
  dateLabel,
  ConfirmDialog,
  BusyButton,
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
  const [preview, setPreview] = useState(null);
  const [sendOpen, setSendOpen] = useState(false);
  const duplicate = useAction(async () => {
    const { data } = await api.post(`/campaigns/${id}/duplicate`);
    navigate(`/campaigns/${data.id}`);
    return data;
  }, 'Campaign duplicated', {
    invalidatePrefixes: ['/campaigns'],
    awaitRefetch: false,
  });
  const exportAction = useAction(
    () => downloadFile(`/campaigns/${id}/report`, `${query.data.name}.csv`),
    'Report downloaded',
  );
  const send = useAction(async () => {
    const campaign = query.data;
    return (
      await api.post(`/campaigns/${id}/approve`, {
        revision: campaign.revision,
        confirm: true,
      })
    ).data;
  }, '', {
    invalidatePrefixes: ['/campaigns', '/analytics', '/recipients', '/emails'],
    awaitRefetch: false,
    onSuccess: async () => {
      setSendOpen(false);
      // Approve returns a compact campaign record. Always refetch the full
      // detail shape before rendering live progress (counts, recipients, and
      // attachments), otherwise the route can crash on a partial cache value.
      await query.refetch();
      toast.success('Campaign delivery has started. Live progress is shown below.');
    },
  });
  useEffect(() => {
    // Toast only after Compose navigates here, so it never appears on the compose screen first.
    const key = `mf_delivery_toast_${id}`;
    if (!sessionStorage.getItem(key)) return undefined;
    sessionStorage.removeItem(key);
    const timer = window.setTimeout(() => {
      toast.success('Campaign delivery has started. Live progress is shown below.');
    }, 80);
    return () => window.clearTimeout(timer);
  }, [id]);
  return (
    <QueryState query={query}>
      {(data) => {
        // A route may render once from a transient cache value while its full
        // detail query is refetching. Keep that first paint safe instead of
        // letting optional collections crash the entire workspace route.
        const c = {
          ...data,
          recipients: Array.isArray(data?.recipients) ? data.recipients : [],
          counts: data?.counts || {},
          attachments: Array.isArray(data?.attachments) ? data.attachments : [],
          cc: Array.isArray(data?.cc) ? data.cc : [],
          bcc: Array.isArray(data?.bcc) ? data.bcc : [],
        };
        return <>
          <PageHeader
            eyebrow="CAMPAIGN WORKSPACE"
            title={c.name}
            description={c.description || c.subject}
            backTo="/campaigns"
            backLabel="Back to campaigns"
          >
            <Status value={c.status} />
            <BusyButton
              variant="secondary"
              busy={duplicate.isPending}
              disabled={duplicate.isPending}
              onClick={() => duplicate.mutate()}
            >
              <Copy size={15} />
              {duplicate.isPending ? 'Duplicating…' : 'Duplicate'}
            </BusyButton>
            <Button variant="secondary" onClick={() => exportAction.mutate()}>
              <Download size={15} />
              Report
            </Button>
            {c.status === 'draft' && (
              <>
                <Button variant="secondary" asChild>
                  <Link to={`/compose?edit=${id}`}>Edit draft</Link>
                </Button>
                <Button
                  onClick={() => {
                    if (!c.smtp_account_id) {
                      toast.error('Select a tested SMTP account');
                      return;
                    }
                    setSendOpen(true);
                  }}
                  disabled={send.isPending || !c.recipients.length}
                >
                  <Send size={15} />
                  Send campaign
                </Button>
              </>
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
                    <h3>{c.status === 'draft' ? 'Recipients' : 'Campaign participants'}</h3>
                    <p>
                      {c.status === 'draft'
                        ? 'Read-only preview. Use Edit draft to change recipients or message, or Send campaign to deliver.'
                        : 'Every delivery recipient is retained here, including historical contact snapshots.'}
                    </p>
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
                            <td>{r.template_id ? 'Custom template' : 'Campaign message'}</td>
                            <td>
                              {r.historical ? (
                                <span className="period-chip">Delivery snapshot · {r.delivery_status}</span>
                              ) : (
                                <Status
                                  value={
                                    previews.isLoading || previews.isPending
                                      ? 'ready'
                                      : previews.data?.items.find((p) => p.recipient_id === r.id)
                                            ?.eligible === false
                                        ? 'unavailable'
                                        : 'ready'
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
                    description="Edit the draft to choose recipients before sending."
                  />
                )}
                {previews.isError && (
                  <p className="text-red-400">{previews.error.response?.data?.detail}</p>
                )}
              </section>
              <section className="panel">
                <h3 className="mb-4">Campaign message</h3>
                {c.status === 'draft' && (
                  <p className="mb-4 text-sm opacity-70">Read-only. Open Edit draft to change the subject or body.</p>
                )}
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
          {c.status === 'draft' && (
            <ConfirmDialog
              open={sendOpen}
              onOpenChange={setSendOpen}
              title="Send campaign"
              itemLabel={`${c.recipients.length} selected recipients`}
              message={<>Your campaign will be sent to the selected recipients. After you continue, you’ll see each email’s live delivery status.</>}
              confirmLabel="Review and send"
              processingLabel="Preparing delivery…"
              onConfirm={() => send.mutateAsync()}
            />
          )}
        </>;
      }}
    </QueryState>
  );
}
