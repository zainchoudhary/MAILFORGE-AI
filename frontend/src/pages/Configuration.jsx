import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link } from 'react-router-dom';
import { Plus, Plug, ShieldCheck, CheckCheck, KeyRound, ArrowUpRight, Trash2 } from 'lucide-react';
import { useApi, useAction } from '../hooks/useApi';
import { api } from '../services/api';
import {
  PageHeader,
  QueryState,
  Empty,
  Field,
  BusyButton,
  Status,
  Pagination,
  dateLabel,
  ConfirmDialog,
} from '../components/Common';
import { Button } from '../components/ui/button';
import { Dialog } from '../components/ui/dialog';
const smtpSchema = z.object({
  name: z.string().min(1),
  host: z.string().min(1),
  port: z.coerce.number().int().min(1).max(65535),
  security: z.enum(['starttls', 'ssl']),
  username: z.string(),
  password: z.string().min(1),
  from_email: z.string().email(),
});
export function SMTP() {
  const accounts = useApi('/smtp/accounts');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [open, setOpen] = useState(false);
  const form = useForm({
    resolver: zodResolver(smtpSchema),
    defaultValues: {
      name: 'Gmail workspace',
      host: 'smtp.gmail.com',
      port: 587,
      security: 'starttls',
      username: '',
      password: '',
      from_email: '',
    },
  });
  const save = useAction(async (values) => {
    await api.post('/smtp/accounts', values);
    form.setValue('password', '');
  }, 'SMTP account stored securely', { onSuccess: () => setOpen(false) });
  const test = useAction(
    (id) => api.post(`/smtp/test?account_id=${id}`),
    'SMTP connection verified',
  );
  const remove = useAction((id) => api.delete(`/smtp/accounts/${id}`), 'SMTP account deleted');
  return (
    <>
      <PageHeader
        eyebrow="DELIVERY INFRASTRUCTURE"
        title="Connect your sender"
        description="Encrypted credentials. Verified connections. Clear delivery outcomes."
      >
        <Button onClick={() => setOpen(true)}>
          <Plus size={16} />
          Add SMTP account
        </Button>
      </PageHeader>
      <div className="info-banner">
        <ShieldCheck size={22} />
        <div>
          <strong>Your credentials stay on the server.</strong>
          <p>
            Use a Gmail App Password when applicable. STARTTLS and SSL validate server certificates.
          </p>
        </div>
      </div>
      <QueryState query={accounts}>
        {(d) =>
          d.items.length ? (
            <div className="card-grid mt-6">
              {d.items.map((a) => (
                <section className="panel" key={a.id}>
                  <Plug className="text-blue-300 mb-4" />
                  <h3>{a.name}</h3>
                  <p>{a.from_email}</p>
                  <div className="timeline-row">
                    <span>Server</span>
                    <small>
                      {a.host}:{a.port}
                    </small>
                  </div>
                  <div className="timeline-row">
                    <span>Security</span>
                    <small>{a.security.toUpperCase()}</small>
                  </div>
                  <Status value={a.tested_at ? 'verified' : 'untested'} />
                  <BusyButton
                    className="mt-5 w-full"
                    busy={test.isPending}
                    onClick={() => test.mutate(a.id)}
                  >
                    Test connection
                  </BusyButton>
                  <Button
                    className="mt-2 w-full"
                    variant="ghost"
                    onClick={() => {
                      setDeleteTarget(a);
                    }}
                  >
                    <Trash2 size={14} /> Delete account
                  </Button>
                </section>
              ))}
            </div>
          ) : (
            <section className="panel mt-6">
              <Empty
                title="No sending account connected"
                description="Add an SMTP account to prepare live delivery. You can still draft and dry-run campaigns."
              />
            </section>
          )
        }
      </QueryState>
      <Dialog open={open} onOpenChange={setOpen} busy={save.isPending} title="Add SMTP account">
        <form className="mt-5" onSubmit={form.handleSubmit((v) => save.mutate(v))}>
          {[
            ['name', 'Account label'],
            ['host', 'SMTP host'],
            ['port', 'Port'],
            ['username', 'Username'],
            ['password', 'Password / App Password'],
            ['from_email', 'From email'],
          ].map(([key, label]) => (
            <Field key={key} label={label} error={form.formState.errors[key]}>
              <input
                type={key === 'password' ? 'password' : key === 'port' ? 'number' : 'text'}
                {...form.register(key)}
                autoComplete="off"
              />
            </Field>
          ))}
          <Field label="Transport security">
            <select {...form.register('security')}>
              <option value="starttls">STARTTLS</option>
              <option value="ssl">Implicit TLS / SSL</option>
            </select>
          </Field>
          <BusyButton busy={save.isPending}>{save.isPending ? 'Saving…' : 'Store encrypted account'}</BusyButton>
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
export function Settings() {
  const query = useApi('/settings');
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [digest, setDigest] = useState(false);
  useEffect(() => {
    if (query.data?.preferences) {
      setTimezone(
        query.data.preferences.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
      );
      setDigest(!!query.data.preferences.compact_tables);
    }
  }, [query.data]);
  const save = useAction(
    () => api.put('/settings', { timezone, compact_tables: digest }),
    'Preferences saved',
  );
  const [email, setEmail] = useState('');
  const [reason, setReason] = useState('');
  const [suppressionTarget, setSuppressionTarget] = useState(null);
  const suppressions = useApi('/suppressions');
  const suppress = useAction(async () => {
    z.string().email().parse(email);
    await api.post('/suppressions', { email, reason });
    setEmail('');
    setReason('');
  }, 'Address suppressed');
  const unsuppress = useAction((id) => api.delete(`/suppressions/${id}`), 'Address removed');
  return (
    <>
      <PageHeader
        eyebrow="WORKSPACE CONFIGURATION"
        title="Settings & safeguards"
        description="Your preferences and the controls protecting every campaign."
      />
      <div className="compose-grid">
        <div className="space-y-5">
          <section className="panel">
            <h3 className="mb-5">Workspace preferences</h3>
            <Field label="Display timezone preference">
              <input value={timezone} onChange={(e) => setTimezone(e.target.value)} />
            </Field>
            <label className="check-label mb-5">
              <input
                type="checkbox"
                checked={digest}
                onChange={(e) => setDigest(e.target.checked)}
              />
              Prefer compact tables
            </label>
            <BusyButton busy={save.isPending} onClick={() => save.mutate()}>
              Save preferences
            </BusyButton>
          </section>
          <section className="panel">
            <h3 className="mb-4">Suppression list</h3>
            <p className="mb-4">Suppressed addresses are excluded even when previously approved.</p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                suppress.mutate();
              }}
            >
              <div className="form-grid">
                <Field label="Email address">
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </Field>
                <Field label="Reason">
                  <input required value={reason} onChange={(e) => setReason(e.target.value)} />
                </Field>
              </div>
              <BusyButton busy={suppress.isPending}>Suppress address</BusyButton>
            </form>
            {suppressions.data?.items.map((s) => (
              <div className="file-row" key={s.id}>
                <span>
                  {s.email}
                  <small>{s.reason}</small>
                </span>
                <Status value="suppressed" />
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setSuppressionTarget(s);
                  }}
                >
                  Remove
                </Button>
              </div>
            ))}
          </section>
        </div>
        <QueryState query={query}>
          {(s) => (
            <section className="panel self-start">
              <ShieldCheck size={26} className="text-cyan-300 mb-4" />
              <h3>Server-enforced safeguards</h3>
              {[
                ['Dry run', s.dry_run ? 'Enabled' : 'Disabled — approval required'],
                ['Campaign recipients', 'Unlimited'],
                ['Sending interval', `${s.delay_between_emails} seconds`],
                ['Attachment limit', `${s.max_attachment_bytes / 1000000} MB`],
                ['AI provider', s.ai_provider],
                ['AI credentials', s.ai_configured ? 'Configured' : 'Not configured'],
                ['Malware scanner', s.malware_scan_configured ? 'Configured' : 'Not configured'],
              ].map(([label, value]) => (
                <div className="timeline-row" key={label}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </div>
              ))}
              <small>
                Operational limits are environment configuration, not browser-controlled
                preferences.
              </small>
            </section>
          )}
        </QueryState>
      </div>
      <ConfirmDialog
        open={!!suppressionTarget}
        itemLabel={suppressionTarget?.email}
        title="Remove suppression"
        onOpenChange={(open) => !open && setSuppressionTarget(null)}
        onConfirm={() => unsuppress.mutateAsync(suppressionTarget.id)}
      />
    </>
  );
}
export function Integrations() {
  const query = useApi('/settings');
  const accounts = useApi('/smtp/accounts');
  return (
    <>
      <PageHeader
        eyebrow="CONNECTED OPERATIONS"
        title="Integrations"
        description="Purpose-built connections to your intelligence and delivery infrastructure."
      />
      <QueryState query={query}>
        {(s) => (
          <div className="card-grid">
            {[
              [
                'AI intelligence',
                s.ai_provider.toUpperCase(),
                s.ai_configured ? 'configured' : 'not_configured',
                'Set GROQ_API_KEY or GOOGLE_API_KEY on the backend. Model identifiers are configurable.',
                '/studio',
              ],
              [
                'Email delivery',
                'SMTP',
                (accounts.data?.items.length || 0) > 0 ? 'configured' : 'not_configured',
                'Connect your Gmail or compatible SMTP provider with verified TLS.',
                '/smtp',
              ],
              [
                'Document protection',
                'ClamAV',
                s.malware_scan_configured ? 'configured' : 'not_configured',
                'Set CLAMAV_HOST and REQUIRE_MALWARE_SCAN=true to require scanning before upload.',
                '/documents',
              ],
            ].map(([title, provider, status, description, url]) => (
              <section className="panel integration-card" key={title}>
                <Plug size={25} />
                <small>{provider}</small>
                <h3>{title}</h3>
                <Status value={status} />
                <p>{description}</p>
                <Button variant="secondary" asChild>
                  <Link to={url}>
                    Open workspace <ArrowUpRight size={15} />
                  </Link>
                </Button>
              </section>
            ))}
            <section className="panel integration-card">
              <KeyRound size={25} />
              <small>SIGNED EVENT ADAPTER</small>
              <h3>Provider confirmations</h3>
              <p>
                Connect your provider through an adapter that verifies its webhook and signs
                Outreach Studio events. Delivery, bounce, open, and click events are never inferred from
                SMTP acceptance.
              </p>
              <a className="text-link" href="/docs" target="_blank" rel="noreferrer">
                View webhook API <ArrowUpRight size={15} />
              </a>
            </section>
          </div>
        )}
      </QueryState>
    </>
  );
}
export function Audit() {
  const [page, setPage] = useState(1);
  const query = useApi(`/audit-logs?page=${page}`);
  return (
    <>
      <PageHeader
        eyebrow="ACCOUNTABILITY BY DESIGN"
        title="Audit logs"
        description="Persistent records of sensitive workspace actions."
      />
      <section className="panel">
        <QueryState query={query}>
          {(d) => (
            <>
              {d.items.length ? (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Action</th>
                        <th>Resource</th>
                        <th>Details</th>
                        <th>Timestamp</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.items.map((l) => (
                        <tr key={l.id}>
                          <td>
                            <code>{l.action}</code>
                          </td>
                          <td>
                            <small>{l.resource_id || '—'}</small>
                          </td>
                          <td>
                            <small>{JSON.stringify(l.details)}</small>
                          </td>
                          <td>{dateLabel(l.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty title="No audit entries" />
              )}
              <Pagination data={d} page={page} setPage={setPage} />
            </>
          )}
        </QueryState>
      </section>
    </>
  );
}
export function Automation() {
  const query = useApi('/campaigns?limit=100', { refetchInterval: 5000 });
  return (
    <>
      <PageHeader
        eyebrow="CONTROLLED EXECUTION"
        title="Automation queue"
        description="Approved schedules and active delivery workflows, backed by PostgreSQL and Celery."
      >
        <Button asChild>
          <Link to="/compose">Schedule a campaign</Link>
        </Button>
      </PageHeader>
      <div className="info-banner">
        <ShieldCheck size={22} />
        <p>
          Scheduling prepares a due time. Delivery starts only after recipient review, a dry run,
          and explicit approval.
        </p>
      </div>
      <section className="panel mt-6">
        <QueryState query={query}>
          {(d) => {
            const items = d.items.filter((c) =>
              ['scheduled', 'processing', 'sending', 'paused'].includes(c.status),
            );
            return items.length ? (
              <table>
                <thead>
                  <tr>
                    <th>Campaign</th>
                    <th>Status</th>
                    <th>Scheduled</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {items.map((c) => (
                    <tr key={c.id}>
                      <td>{c.name}</td>
                      <td>
                        <Status value={c.status} />
                      </td>
                      <td>{dateLabel(c.scheduled_at)}</td>
                      <td>
                        <Link className="text-link" to={`/campaigns/${c.id}`}>
                          Manage <ArrowUpRight size={14} />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <Empty
                title="No active automations"
                description="Your approved schedules and sending campaigns will appear here."
              />
            );
          }}
        </QueryState>
      </section>
    </>
  );
}
