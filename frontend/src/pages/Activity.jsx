import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowUpRight, Download, SlidersHorizontal, ArrowDownUp, Search } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { downloadFile } from '../services/api';
import { PageHeader, QueryState, Empty, Status, Pagination, dateLabel, PickerDropdown } from '../components/Common';
import { EmailPreview } from '../components/RichEditor';
import { Button } from '../components/ui/button';
export default function Activity() {
  const [params] = useSearchParams();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState('newest');
  const query = useApi(
    `/emails?page=${page}&q=${encodeURIComponent(q)}&status=${status}&sort=${sort}&campaign_id=${params.get('campaign') || ''}`,
    { refetchInterval: 5000 },
  );
  return (
    <>
      <PageHeader
        eyebrow="EVERY MESSAGE ACCOUNTED FOR"
        title="Email activity"
        description="Follow each message from queue entry to its latest verified event."
      />
      <section className="panel">
        <div className="filter-bar">
          <div className="search-input">
            <Search size={16} aria-hidden="true" />
            <input
              type="text"
              aria-label="Search messages"
              placeholder="Search recipient or subject"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <PickerDropdown
            ariaLabel="Filter messages by status"
            value={status}
            icon={SlidersHorizontal}
            placeholder="All statuses"
            onChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
            options={['', ...[
              'queued',
              'sending',
              'smtp_accepted',
              'delivered',
              'bounced',
              'failed',
              'opened',
              'clicked',
              'uncertain',
              'cancelled',
            ]].map((value) => ({ value, label: value ? value.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase()) : 'All statuses' }))}
          />
          <PickerDropdown
            ariaLabel="Sort messages"
            icon={ArrowDownUp}
            value={sort}
            onChange={(value) => { setSort(value); setPage(1); }}
            options={[{ value: 'newest', label: 'Newest first' }, { value: 'oldest', label: 'Oldest first' }, { value: 'recipient', label: 'Recipient A–Z' }]}
          />
          {(q || status || sort !== 'newest') && <Button variant="ghost" size="sm" onClick={() => { setQ(''); setStatus(''); setSort('newest'); setPage(1); }}>Clear filters</Button>}
        </div>
        <QueryState query={query}>
          {(d) => (
            <>
              {d.items.length ? (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Recipient / subject</th>
                        <th>Status</th>
                        <th>Attempts</th>
                        <th>Sent at</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {d.items.map((m) => (
                        <tr key={m.id}>
                          <td>
                            <Link className="table-title" to={`/activity/${m.id}`}>
                              {m.recipient_email}
                            </Link>
                            <small>{m.subject}</small>
                          </td>
                          <td>
                            <Status value={m.status} />
                          </td>
                          <td>{m.attempts}</td>
                          <td>{dateLabel(m.sent_at)}</td>
                          <td>
                            <Link aria-label={`Inspect ${m.subject}`} to={`/activity/${m.id}`}>
                              <ArrowUpRight size={16} />
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty
                  title="No messages match this view"
                  description="Approved campaign messages appear here. Dry runs do not create delivery claims."
                />
              )}
              <Pagination data={d} page={page} setPage={setPage} />
            </>
          )}
        </QueryState>
      </section>
    </>
  );
}
export function EmailDetail() {
  const { id } = useParams();
  const query = useApi(`/emails/${id}`, { refetchInterval: 5000 });
  return (
    <QueryState query={query}>
      {(m) => (
        <>
          <PageHeader
            eyebrow="MESSAGE INSPECTION"
            title={m.subject}
            description={`Message ID: ${m.id}`}
            backTo="/activity"
            backLabel="Back to email activity"
          >
            <Status value={m.status} />
            <Button variant="secondary" asChild>
              <Link to={`/campaigns/${m.campaign_id}`}>
                Related campaign <ArrowUpRight size={15} />
              </Link>
            </Button>
          </PageHeader>
          <div className="compose-grid">
            <section className="panel">
              <EmailPreview
                subject={m.subject}
                body={m.body}
                recipient={`${m.recipient_name} <${m.recipient_email}>`}
              />
              <h3 className="mt-6 mb-3">Attachments</h3>
              {m.attachments.length ? (
                m.attachments.map((a) => (
                  <div className="file-row" key={a.id}>
                    {a.filename}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => downloadFile(`/documents/${a.id}/download`, a.filename)}
                    >
                      <Download size={14} />
                      Download
                    </Button>
                  </div>
                ))
              ) : (
                <p>No attachments</p>
              )}
              <h3 className="mt-6 mb-3">Delivery attempts</h3>
              {m.attempts_history.length ? (
                m.attempts_history.map((a) => (
                  <div className="attempt-card" key={a.id}>
                    <strong>Attempt {a.number}</strong>
                    <Status value={a.status} />
                    <p>{a.response || 'Awaiting SMTP response'}</p>
                    <small>{dateLabel(a.created_at)}</small>
                  </div>
                ))
              ) : (
                <p>No SMTP attempts yet.</p>
              )}
            </section>
            <aside className="space-y-5">
              <section className="panel">
                <h3>Latest outcome</h3>
                <p className="mt-4">{m.smtp_response || 'No SMTP acceptance recorded.'}</p>
                {m.error && <div className="error-panel mt-4">{m.error}</div>}
                <div className="quiet-note mt-4">
                  Only signed provider events establish delivery, open, or click confirmation.
                </div>
              </section>
              <section className="panel">
                <h3 className="mb-4">Activity timeline</h3>
                {m.events.map((e) => (
                  <div className="timeline-event" key={e.id}>
                    <Status value={e.kind} />
                    <small>{dateLabel(e.created_at)}</small>
                    <p>{JSON.stringify(e.details)}</p>
                  </div>
                ))}
              </section>
            </aside>
          </div>
        </>
      )}
    </QueryState>
  );
}
