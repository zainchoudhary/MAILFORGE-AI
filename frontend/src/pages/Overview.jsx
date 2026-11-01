import { Link } from 'react-router-dom';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import {
  ArrowRight,
  ArrowUpRight,
  Bot,
  CheckCheck,
  FileScan,
  Mail,
  Plus,
  Send,
  ShieldCheck,
  Sparkles,
  Users,
  Workflow,
} from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { Button } from '../components/ui/button';
import { PageHeader, QueryState, Empty, Status, dateLabel } from '../components/Common';
const colors = ['#2563EB', '#16A34A', '#64748B', '#0F172A', '#DC2626', '#94A3B8'];
export function ActivityChart({ data }) {
  return data.length ? (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={data} margin={{ top: 20, right: 12, left: -25, bottom: 0 }}>
        <defs>
          <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2563EB" stopOpacity={0.2} />
            <stop offset="100%" stopColor="#2563EB" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="#E2E8F0" vertical={false} strokeDasharray="3 5" />
        <XAxis
          dataKey="date"
          tick={{ fill: '#64748B', fontSize: 10 }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          allowDecimals={false}
          tick={{ fill: '#64748B', fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          contentStyle={{
            background: '#FFFFFF',
            border: '1px solid #E2E8F0',
            borderRadius: 10,
            color: '#0F172A',
          }}
        />
        <Area
          name="Processed messages"
          type="monotone"
          dataKey="total"
          stroke="#2563EB"
          strokeWidth={2.5}
          fill="url(#chartFill)"
        />
        <Area
          name="SMTP accepted"
          type="monotone"
          dataKey="accepted"
          stroke="#16A34A"
          fill="transparent"
          strokeWidth={2}
        />
      </AreaChart>
    </ResponsiveContainer>
  ) : (
    <Empty
      title="Your activity starts with the first send"
      description="Daily totals will appear after real messages enter the delivery queue."
    />
  );
}
export default function Overview() {
  const metrics = useApi('/analytics/overview', { refetchInterval: 15000 });
  const activity = useApi('/analytics/emails?days=30');
  const campaigns = useApi('/campaigns?limit=5');
  const settings = useApi('/settings');
  return (
    <>
      <PageHeader
        eyebrow="YOUR EMAIL COMMAND CENTER"
        title="Workspace overview"
        description="A clear view of your campaigns, conversations, and delivery."
      >
        <Button variant="secondary" asChild>
          <Link to="/documents">
            <FileScan size={16} />
            Import documents
          </Link>
        </Button>
        <Button asChild>
          <Link to="/compose">
            <Plus size={17} />
            Create campaign
          </Link>
        </Button>
      </PageHeader>
      <div className="overview-hero">
        <div>
          <div className="hero-tag">
            <Sparkles size={13} /> DOCUMENTS IN. OPPORTUNITIES OUT.
          </div>
          <h2>
            Your next conversation
            <br />
            starts with a little intelligence.
          </h2>
          <p>
            Turn scattered recipient data into thoughtful, personalized campaigns.
            <br />
            Your AI agents handle the complexity. You stay in control.
          </p>
          <Button asChild>
            <Link to="/studio">
              Open AI Agent Studio <ArrowUpRight size={16} />
            </Link>
          </Button>
        </div>
        <div className="hero-visual" aria-hidden="true">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="flow-node document-node">
            <FileScan />
            <span>Understand</span>
          </div>
          <div className="flow-node core-node">
            <div>
              <Bot size={36} />
            </div>
            <span>OUTREACH STUDIO</span>
          </div>
          <div className="flow-node send-node">
            <Send />
            <span>Connect</span>
          </div>
          <div className="flow-caption">
            <span /> INTELLIGENCE WITH INTENTION
          </div>
        </div>
      </div>
      <QueryState query={metrics}>
        {(m) => (
          <>
            <div className="stat-grid">
              {[
                ['Total campaigns', m.campaigns, Workflow, 'Across your workspace'],
                ['Recipients', m.recipients, Users, 'Unique recipient records'],
                ['SMTP accepted', m.smtp_accepted, Send, 'Accepted by sending server'],
                [
                  'Confirmed deliveries',
                  m.confirmed_deliveries,
                  CheckCheck,
                  'Provider-confirmed events',
                ],
              ].map(([label, value, Icon, note]) => (
                <div className="stat-card" key={label}>
                  <div>
                    <span>{label}</span>
                    <Icon size={18} />
                  </div>
                  <strong>{value.toLocaleString()}</strong>
                  <small>{note}</small>
                </div>
              ))}
            </div>
            <div className="dashboard-columns">
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h3>Email activity</h3>
                    <p>Real message volume over the last 30 days</p>
                  </div>
                  <span className="period-chip">Last 30 days</span>
                </div>
                <QueryState query={activity}>{(d) => <ActivityChart data={d.items} />}</QueryState>
                <div className="chart-legend">
                  <span>
                    <i style={{ background: '#2563EB' }} />
                    Processed
                  </span>
                  <span>
                    <i style={{ background: '#16A34A' }} />
                    SMTP accepted
                  </span>
                </div>
              </section>
              <section className="panel delivery-panel">
                <div className="panel-heading">
                  <div>
                    <h3>Delivery snapshot</h3>
                    <p>Every outcome, accurately labeled</p>
                  </div>
                </div>
                {m.total ? (
                  <>
                    <ResponsiveContainer width="100%" height={175}>
                      <PieChart>
                        <Pie
                          data={Object.entries(m.statuses).map(([name, value]) => ({
                            name,
                            value,
                          }))}
                          innerRadius={57}
                          outerRadius={75}
                          paddingAngle={4}
                          dataKey="value"
                          stroke="none"
                        >
                          {Object.keys(m.statuses).map((k, i) => (
                            <Cell key={k} fill={colors[i % colors.length]} />
                          ))}
                        </Pie>
                        <Tooltip contentStyle={{ background: '#FFFFFF', borderColor: '#E2E8F0' }} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="status-key">
                      {Object.entries(m.statuses).map(([key, value], i) => (
                        <div key={key}>
                          <span>
                            <i style={{ background: colors[i % colors.length] }} />
                            {key.replaceAll('_', ' ')}
                          </span>
                          <strong>{value}</strong>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <Empty
                    title="No delivery events"
                    description="A dry run never counts as a send."
                  />
                )}
                <div className="quiet-note">
                  <ShieldCheck size={14} />
                  SMTP acceptance is not inbox confirmation.
                </div>
              </section>
            </div>
          </>
        )}
      </QueryState>
      <div className="dashboard-columns bottom-columns">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h3>Recent campaigns</h3>
              <p>Your latest email operations</p>
            </div>
            <Link className="text-link" to="/campaigns">
              View all <ArrowRight size={14} />
            </Link>
          </div>
          <QueryState query={campaigns}>
            {(d) =>
              d.items.length ? (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Campaign</th>
                        <th>Status</th>
                        <th>Created</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {d.items.map((c) => (
                        <tr key={c.id}>
                          <td>
                            <Link to={`/campaigns/${c.id}`} className="table-title">
                              <span className="table-icon">
                                <Mail size={16} />
                              </span>
                              {c.name}
                            </Link>
                          </td>
                          <td>
                            <Status value={c.status} />
                          </td>
                          <td>{new Date(c.created_at).toLocaleDateString()}</td>
                          <td>
                            <Link to={`/campaigns/${c.id}`} aria-label={`Open ${c.name}`}>
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
                  title="Make your first campaign count"
                  description="Start with a document or compose your own message."
                  action={
                    <Button variant="secondary" asChild>
                      <Link to="/compose">
                        Create a campaign <ArrowRight size={14} />
                      </Link>
                    </Button>
                  }
                />
              )
            }
          </QueryState>
        </section>
        <section className="panel launchpad">
          <div className="panel-heading">
            <div>
              <h3>Workspace launchpad</h3>
              <p>A thoughtful setup for better sending</p>
            </div>
            <Sparkles size={18} />
          </div>
          {[
            ['01', 'Connect your sender', 'Configure and test your SMTP account.', '/smtp'],
            ['02', 'Bring your recipients', 'Extract and review document contacts.', '/documents'],
            [
              '03',
              'Compose with confidence',
              'Personalize, preview, and run a safe test.',
              '/compose',
            ],
          ].map(([n, title, desc, url]) => (
            <Link key={n} to={url}>
              <span>{n}</span>
              <div>
                <strong>{title}</strong>
                <p>{desc}</p>
              </div>
              <ArrowUpRight size={16} />
            </Link>
          ))}
          <div className="launchpad-safe">
            <ShieldCheck size={17} />
            {settings.data?.dry_run
              ? 'Your workspace is in safe dry-run mode.'
              : 'Every production campaign requires approval.'}
          </div>
        </section>
      </div>
    </>
  );
}
