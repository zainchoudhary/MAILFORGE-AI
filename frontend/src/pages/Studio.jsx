import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Bot,
  FileScan,
  PenLine,
  Workflow,
  Send,
  ChartNoAxesCombined,
  Sparkles,
  ArrowUp,
} from 'lucide-react';
import { useApi, useAction } from '../hooks/useApi';
import { api } from '../services/api';
import { PageHeader, Status, BusyButton, QueryState, Empty, dateLabel, PickerDropdown } from '../components/Common';
import { Button } from '../components/ui/button';
const agents = [
  ['Document intelligence', FileScan, 'Parse, OCR, extract, deduplicate.'],
  ['Email composition', PenLine, 'Write with context and a clear voice.'],
  ['Campaign planning', Workflow, 'Plan batches and reviewable steps.'],
  ['Email delivery', Send, 'Inspect queues and delivery outcomes.'],
  ['Analytics intelligence', ChartNoAxesCombined, 'Turn real activity into useful insights.'],
];
export default function Studio() {
  const [instruction, setInstruction] = useState('');
  const [campaign, setCampaign] = useState('');
  const [documents, setDocuments] = useState([]);
  const [messages, setMessages] = useState([]);
  const runs = useApi('/agents/executions', { refetchInterval: 10000 });
  const docs = useApi('/documents?limit=100');
  const campaigns = useApi('/campaigns?limit=100');
  const [log, setLog] = useState(null);
  const execution = useApi(`/agents/executions/${log}`, { enabled: !!log });
  const send = useAction(async () => {
    const text = instruction;
    setMessages((m) => [...m, { role: 'user', text }]);
    setInstruction('');
    const { data } = await api.post('/ai/campaign-assistant', {
      instruction: text,
      action: 'copilot',
      campaign_id: campaign || null,
      document_ids: documents,
    });
    setMessages((m) => [...m, { role: 'assistant', data }]);
  }, 'Agent workflow completed');
  return (
    <>
      <PageHeader
        eyebrow="INTELLIGENCE, WITH INTENTION"
        title="AI Agent Studio"
        description="Specialized Python agents. One controlled orchestration layer."
      />
      <div className="agent-grid">
        {agents.map(([name, Icon, desc]) => (
          <div className="agent-card" key={name}>
            <Icon size={21} />
            <h3>{name}</h3>
            <p>{desc}</p>
            <span>
              <i />
              LangGraph node
            </span>
          </div>
        ))}
      </div>
      <div className="compose-grid mt-6">
        <section className="panel copilot">
          <div className="panel-heading">
            <div className="flex gap-3 items-center">
              <div className="ai-panel-icon">
                <Bot size={24} />
              </div>
              <div>
                <h3>Campaign copilot</h3>
                <p>Your next step, thoughtfully prepared.</p>
              </div>
            </div>
            <span className="period-chip">Approval protected</span>
          </div>
          <div className="chat-messages">
            {!messages.length ? (
              <div className="copilot-empty">
                <Sparkles size={31} />
                <h2>What are we working on?</h2>
                <p>
                  Ask for a campaign plan, explain failed messages, or analyze your email activity.
                </p>
                {[
                  'Prepare a professional partnership campaign for review.',
                  'Show failed emails and explain the SMTP errors.',
                  'Summarize campaign performance and recommend next steps.',
                ].map((s) => (
                  <button key={s} onClick={() => setInstruction(s)}>
                    {s}
                    <ArrowUp size={15} />
                  </button>
                ))}
              </div>
            ) : (
              messages.map((m, i) => (
                <div className={`chat-message ${m.role}`} key={i}>
                  {m.text || (
                    <>
                      <strong>{m.data.summary}</strong>
                      {m.data.steps && (
                        <ol>
                          {m.data.steps.map((s, n) => (
                            <li key={n}>{s}</li>
                          ))}
                        </ol>
                      )}
                      {m.data.failed_emails?.map((f) => (
                        <p key={f.id}>
                          {f.recipient}: {f.error}
                        </p>
                      ))}
                      {m.data.extractions?.length > 0 && (
                        <p>
                          {m.data.extractions.length} document extractions queued. Review candidates
                          in Document Intelligence.
                        </p>
                      )}
                      {m.data.draft_campaign_id && (
                        <Link className="text-link" to={`/campaigns/${m.data.draft_campaign_id}`}>
                          Open prepared campaign draft →
                        </Link>
                      )}
                      <small>No campaign was sent. Review and approval remain required.</small>
                    </>
                  )}
                </div>
              ))
            )}
          </div>
          <div className="chat-context">
            <PickerDropdown searchable value={campaign} onChange={setCampaign} placeholder="Add campaign context" ariaLabel="Add campaign context" options={(campaigns.data?.items || []).map((item) => ({ value: item.id, label: item.name, description: item.status }))} />
            <PickerDropdown searchable value="" onChange={(documentId) => setDocuments([...new Set([...documents, documentId])])} placeholder={`Attach document context (${documents.length})`} ariaLabel="Attach document context" options={(docs.data?.items || []).map((item) => ({ value: item.id, label: item.filename, description: 'Private workspace document' }))} />
            {documents.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setDocuments([])}>
                Clear files
              </Button>
            )}
          </div>
          <form
            className="chat-input"
            onSubmit={(e) => {
              e.preventDefault();
              if (instruction.trim()) send.mutate();
            }}
          >
            <textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="Describe the outcome you want…"
              rows={3}
            />
            <BusyButton
              busy={send.isPending}
              disabled={!instruction.trim()}
              aria-label="Run copilot"
            >
              <ArrowUp size={18} />
            </BusyButton>
          </form>
        </section>
        <aside className="panel">
          <div className="panel-heading">
            <h3>Execution history</h3>
          </div>
          <div className="execution-history-scroll">
            <QueryState query={runs}>
              {(d) =>
                d.items.length ? (
                  d.items.map((r) => (
                    <button className="execution-row" key={r.id} onClick={() => setLog(r.id)}>
                      <div>
                        <strong>{r.agent}</strong>
                        <small>{dateLabel(r.created_at)}</small>
                      </div>
                      <Status value={r.status} />
                    </button>
                  ))
                ) : (
                  <Empty
                    title="No agent runs yet"
                    description="Execution logs appear after real workflows run."
                  />
                )
              }
            </QueryState>
          </div>
          {execution.data && (
            <div className="mt-5">
              <h3>Run details</h3>
              {execution.data.logs.map((l) => (
                <div className="timeline-event" key={l.id}>
                  <strong>{l.step}</strong>
                  <Status value={l.status} />
                  <p>{l.details.error || 'Step completed'}</p>
                </div>
              ))}
              {execution.data.error && <p className="text-red-400">{execution.data.error}</p>}
            </div>
          )}
        </aside>
      </div>
    </>
  );
}
