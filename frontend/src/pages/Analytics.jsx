import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { useApi, useAction } from '../hooks/useApi';
import { api } from '../services/api';
import { PageHeader, QueryState, Empty, Status, BusyButton } from '../components/Common';
import { ActivityChart } from './Overview';
export default function Analytics() {
  const [days, setDays] = useState(30);
  const [insight, setInsight] = useState(null);
  const metrics = useApi('/analytics/overview');
  const activity = useApi(`/analytics/emails?days=${days}`);
  const campaigns = useApi('/analytics/campaigns');
  const failures = useApi('/emails?status=failed&limit=5');
  const ai = useAction(async () => {
    setInsight(
      (
        await api.post('/ai/campaign-assistant', {
          action: 'analytics',
          instruction: 'Analyze actual campaign performance and failure patterns.',
        })
      ).data,
    );
  }, 'Insights generated from workspace data');
  return (
    <>
      <PageHeader
        eyebrow="SIGNALS, NOT GUESSWORK"
        title="Email intelligence"
        description="Understand performance using recorded outcomes and verified events."
      >
        <BusyButton busy={ai.isPending} onClick={() => ai.mutate()}>
          <Sparkles size={16} />
          Generate AI insights
        </BusyButton>
      </PageHeader>
      <QueryState query={metrics}>
        {(m) => (
          <div className="stat-grid analytics-stats">
            {[
              ['Processed', m.processed],
              ['Emails sent', m.smtp_accepted],
              ['Confirmed deliveries', m.confirmed_deliveries],
              ['Failed', m.failed],
              ['Bounced', m.bounced],
              ['Pending', m.pending],
              ['Scheduled', m.scheduled],
              ['Acceptance rate', `${m.success_rate}%`],
              ['Failure rate', `${m.failure_rate}%`],
            ].map(([l, v]) => (
              <div className="stat-card" key={l}>
                <span>{l}</span>
                <strong>{v}</strong>
              </div>
            ))}
          </div>
        )}
      </QueryState>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h3>Activity over time</h3>
            <p>Message creation date, grouped by current recorded outcome</p>
          </div>
          <select aria-label="Analytics date range" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
        </div>
        <QueryState query={activity}>{(d) => <ActivityChart data={d.items} />}</QueryState>
      </section>
      {insight && (
        <section className="panel ai-insight mt-5">
          <Sparkles size={22} />
          <h3>AI performance brief</h3>
          <p>{insight.summary}</p>
          <ul>
            {insight.recommendations?.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </section>
      )}
      <div className="dashboard-columns mt-5">
        <section className="panel">
          <h3 className="mb-4">Campaign comparison</h3>
          <QueryState query={campaigns}>
            {(d) =>
              d.items.length ? (
                <table>
                  <thead>
                    <tr>
                      <th>Campaign</th>
                      <th>Status</th>
                      <th>Messages</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.items.map((c) => (
                      <tr key={c.id}>
                        <td>
                          <Link to={`/campaigns/${c.id}`}>{c.name}</Link>
                        </td>
                        <td>
                          <Status value={c.status} />
                        </td>
                        <td>{c.total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <Empty title="No campaign data yet" />
              )
            }
          </QueryState>
        </section>
        <section className="panel">
          <h3 className="mb-4">Recent failures</h3>
          <QueryState query={failures}>
            {(d) =>
              d.items.length ? (
                d.items.map((m) => (
                  <Link className="execution-row" key={m.id} to={`/activity/${m.id}`}>
                    <div>
                      <strong>{m.recipient_email}</strong>
                      <small>{m.error}</small>
                    </div>
                  </Link>
                ))
              ) : (
                <Empty
                  title="No failed messages"
                  description="Recorded failures will appear here for inspection."
                />
              )
            }
          </QueryState>
        </section>
      </div>
    </>
  );
}
