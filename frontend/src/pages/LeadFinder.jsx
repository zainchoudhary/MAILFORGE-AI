import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Ban, CheckCircle2, ExternalLink, FolderPlus, Plus } from 'lucide-react';
import { useApi, useAction } from '../hooks/useApi';
import { errorText } from '../services/api';
import {
  cancelRun,
  continueRun,
  isRunActive,
  patchCandidate,
  progressLine,
  progressPercent,
  saveGroup,
  saveResultSummary,
  setCandidatesSelected,
} from '../services/leadFinder';
import { BusyButton, Empty, Field, PageHeader, QueryState, Status } from '../components/Common';
import { Button } from '../components/ui/button';
import { Dialog } from '../components/ui/dialog';

const RUNS_KEY = '/lead-finder/runs';
const POLL_MS = 2000;

const StatusBadge = ({ status }) => <Status value={status} />;

function CandidateRow({ runId, candidate, onChanged, onSelect }) {
  const [draft, setDraft] = useState({ name: candidate.name, company: candidate.company, position: candidate.position });
  const [saving, setSaving] = useState(false);
  const dirty = useRef(new Set());
  useEffect(() => {
    setDraft((current) => {
      const next = { ...current };
      for (const field of ['name', 'company', 'position']) {
        if (!dirty.current.has(field)) next[field] = candidate[field];
      }
      return next;
    });
  }, [candidate.name, candidate.company, candidate.position]);

  const save = async (changes) => {
    setSaving(true);
    try {
      await patchCandidate(runId, candidate.id, changes);
      onChanged();
    } catch (error) {
      toast.error(errorText(error));
      setDraft({ name: candidate.name, company: candidate.company, position: candidate.position });
    } finally {
      setSaving(false);
    }
  };
  const commit = (field) => {
    dirty.current.delete(field);
    const value = (draft[field] || '').trim();
    if (value !== (candidate[field] || '')) save({ [field]: value });
  };
  const cell = (field, label) => (
    <input
      aria-label={`${label} for ${candidate.email}`}
      value={draft[field]}
      disabled={saving}
      onChange={(event) => {
        dirty.current.add(field);
        setDraft((current) => ({ ...current, [field]: event.target.value }));
      }}
      onBlur={() => commit(field)}
      onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
    />
  );
  return (
    <tr className={candidate.selected ? 'lead-row selected' : 'lead-row'}>
      <td className="table-check">
        <input
          type="checkbox"
          aria-label={`Select ${candidate.email}`}
          checked={!!candidate.selected}
          onChange={(event) => onSelect(candidate.id, event.target.checked)}
        />
      </td>
      <td>{cell('name', 'Name')}</td>
      <td>{cell('company', 'Company')}</td>
      <td>{cell('position', 'Position')}</td>
      <td className="lead-email">
        <strong>{candidate.email}</strong>
        {candidate.existing_recipient_id && <small>Already in your recipients</small>}
      </td>
      <td>
        {candidate.source_url ? (
          <a className="lead-source" href={candidate.source_url} target="_blank" rel="noopener noreferrer" title={candidate.source_title || candidate.source_url}>
            <ExternalLink size={13} /> Source
          </a>
        ) : <small>—</small>}
      </td>
    </tr>
  );
}

export default function LeadFinder() {
  const client = useQueryClient();
  const { runId: activeId } = useParams();
  const [saveOpen, setSaveOpen] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [saved, setSaved] = useState(null);

  const run = useApi(`${RUNS_KEY}/${activeId}`, {
    enabled: !!activeId,
    refetchInterval: (query) => (isRunActive(query.state.data) ? POLL_MS : false),
  });
  const candidatesUrl = `${RUNS_KEY}/${activeId}/candidates?limit=200`;
  const candidates = useApi(candidatesUrl, {
    enabled: !!activeId,
    refetchInterval: () => (isRunActive(run.data) ? POLL_MS : false),
  });

  const runData = run.data;
  const active = isRunActive(runData);
  // Pending selection overrides survive background polls until the PATCH lands.
  const selectionOverrides = useRef(new Map());
  const [, setSelectionTick] = useState(0);
  const rawItems = candidates.data?.items || [];
  const items = selectionOverrides.current.size
    ? rawItems.map((candidate) =>
        selectionOverrides.current.has(candidate.id)
          ? { ...candidate, selected: selectionOverrides.current.get(candidate.id) }
          : candidate
      )
    : rawItems;
  const selectedCount = items.filter((candidate) => candidate.selected).length;
  const allSelected = items.length > 0 && selectedCount === items.length;
  const someSelected = selectedCount > 0 && !allSelected;
  const refreshRunViews = () => client.invalidateQueries({ predicate: (query) => typeof query.queryKey[0] === 'string' && query.queryKey[0].startsWith(RUNS_KEY) });
  const selectAllRef = useRef(null);
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someSelected;
  }, [someSelected, allSelected, items.length]);

  /** Instant UI; PATCH in background. No await / full refetch on click. */
  const setSelection = (ids, selected) => {
    if (!activeId || !ids.length) return;
    const idSet = new Set(ids);
    const previous = new Map(
      items.filter((candidate) => idSet.has(candidate.id)).map((candidate) => [candidate.id, !!candidate.selected])
    );
    const targets = items.filter(
      (candidate) => idSet.has(candidate.id) && !!candidate.selected !== !!selected
    );
    if (!targets.length) return;

    for (const id of ids) selectionOverrides.current.set(id, selected);
    client.setQueriesData({ queryKey: [candidatesUrl] }, (current) => {
      if (!current?.items) return current;
      return {
        ...current,
        items: current.items.map((candidate) =>
          idSet.has(candidate.id) ? { ...candidate, selected } : candidate
        ),
      };
    });
    setSelectionTick((tick) => tick + 1);

    void (async () => {
      try {
        if (targets.length === 1) await patchCandidate(activeId, targets[0].id, { selected });
        else await setCandidatesSelected(activeId, targets, selected);
        for (const id of ids) {
          if (selectionOverrides.current.get(id) === selected) selectionOverrides.current.delete(id);
        }
        setSelectionTick((tick) => tick + 1);
      } catch (error) {
        for (const [id, wasSelected] of previous) selectionOverrides.current.set(id, wasSelected);
        client.setQueriesData({ queryKey: [candidatesUrl] }, (current) => {
          if (!current?.items) return current;
          return {
            ...current,
            items: current.items.map((candidate) =>
              previous.has(candidate.id) ? { ...candidate, selected: previous.get(candidate.id) } : candidate
            ),
          };
        });
        setSelectionTick((tick) => tick + 1);
        toast.error(errorText(error));
      }
    })();
  };

  const toggleSelectAll = (selected) => {
    setSelection(items.map((candidate) => candidate.id), selected);
  };

  // When a run finishes, pull in the final candidate list once.
  const [wasActive, setWasActive] = useState(false);
  useEffect(() => {
    if (wasActive && !active) refreshRunViews();
    setWasActive(active);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const more = useAction(() => continueRun(activeId), 'Searching for more leads', { invalidatePrefixes: [RUNS_KEY] });
  const cancel = useAction(() => cancelRun(activeId), 'Search cancelled — partial leads kept', { invalidatePrefixes: [RUNS_KEY] });
  const save = useAction(() => saveGroup(activeId, groupName.trim()), (data) => `Saved ${saveResultSummary(data)}`, {
    invalidatePrefixes: [RUNS_KEY, '/recipient-groups', '/recipients'],
    onSuccess: (data) => {
      setSaved(data);
      setSaveOpen(false);
      setGroupName('');
    },
  });

  if (!activeId) {
    return <Navigate to="/lead-finder/gmail" replace />;
  }

  return (
    <>
      <PageHeader
        eyebrow="OUTREACH INTELLIGENCE"
        title={runData?.instruction || 'Google search'}
        description="Review leads from this search, then save a recipient group."
        backTo="/lead-finder/gmail"
        backLabel="Back to searches"
      />

      <div className="lead-detail">
            <section className="panel">
              <QueryState query={run}>
                {() => (
                  <>
                    <div className="panel-heading">
                      <div>
                        <h2 className="lead-run-title">{runData.instruction}</h2>
                        <p>{progressLine(runData)}</p>
                      </div>
                      <StatusBadge status={runData.status} />
                    </div>
                    {active && (
                      <div className="sending-progress" role="progressbar" aria-valuenow={progressPercent(runData)} aria-valuemin={0} aria-valuemax={100} aria-label="Lead search progress">
                        <span style={{ width: `${Math.max(progressPercent(runData), 4)}%` }} />
                      </div>
                    )}
                    {runData.status === 'failed' && (
                      <div className="error-panel lead-error" role="alert">
                        <h3>This search couldn’t finish</h3>
                        <p>{runData.error || runData.progress?.message || 'Something went wrong while searching.'}</p>
                      </div>
                    )}
                    {runData.progress?.warning && !active && <p className="lead-warning">{runData.progress.warning}</p>}
                    <div className="lead-toolbar">
                      <div className="lead-selection-tools">
                        <span className="selection-indicator">{selectedCount} of {items.length} selected</span>
                        {items.length > 0 && (
                          <>
                            <Button type="button" variant="secondary" size="sm" disabled={allSelected} onClick={() => toggleSelectAll(true)}>
                              Select all
                            </Button>
                            <Button type="button" variant="secondary" size="sm" disabled={selectedCount === 0} onClick={() => toggleSelectAll(false)}>
                              Clear
                            </Button>
                          </>
                        )}
                      </div>
                      <div className="lead-toolbar-actions">
                        {active && (
                          <BusyButton variant="secondary" size="sm" busy={cancel.isPending} onClick={() => cancel.mutate()}>
                            <Ban size={14} /> Cancel
                          </BusyButton>
                        )}
                        <BusyButton variant="secondary" size="sm" busy={more.isPending} disabled={active || runData.status === 'failed'} onClick={() => more.mutate()}>
                          <Plus size={14} /> Find more
                        </BusyButton>
                        <Button size="sm" disabled={!selectedCount} onClick={() => setSaveOpen(true)}>
                          <FolderPlus size={14} /> Save as group
                        </Button>
                      </div>
                    </div>
                    {saved && (
                      <div className="lead-saved" role="status">
                        <CheckCircle2 size={18} />
                        <div>
                          <strong>{saveResultSummary(saved)}</strong>
                          <small>
                            <Link to="/recipient-groups">View recipient groups</Link> · <Link to="/compose">Compose a campaign</Link>
                          </small>
                        </div>
                      </div>
                    )}
                    <QueryState query={candidates}>
                      {() => items.length ? (
                        <div className="table-scroll">
                          <table className="lead-table">
                            <thead>
                              <tr>
                                <th className="table-check">
                                  <input
                                    ref={selectAllRef}
                                    type="checkbox"
                                    aria-label="Select all leads"
                                    checked={allSelected}
                                    disabled={!items.length}
                                    onChange={(event) => toggleSelectAll(event.target.checked)}
                                  />
                                </th>
                                <th>Name</th>
                                <th>Company</th>
                                <th>Position</th>
                                <th>Email</th>
                                <th>Source</th>
                              </tr>
                            </thead>
                            <tbody>
                              {items.map((candidate) => (
                                <CandidateRow
                                  key={candidate.id}
                                  runId={activeId}
                                  candidate={candidate}
                                  onChanged={refreshRunViews}
                                  onSelect={(id, selected) => setSelection([id], selected)}
                                />
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <Empty
                          title={active ? 'Searching…' : 'No leads found yet'}
                          description={active ? 'Leads appear here as soon as they are found.' : 'Try broadening the location or role, then use Find more.'}
                        />
                      )}
                    </QueryState>
                  </>
                )}
              </QueryState>
            </section>
      </div>

      <Dialog open={saveOpen} onOpenChange={setSaveOpen} busy={save.isPending} title="Save as recipient group" description="Selected leads are added to your recipients and grouped for campaigns.">
        <form
          className="group-editor"
          onSubmit={(event) => {
            event.preventDefault();
            if (groupName.trim()) save.mutate();
          }}
        >
          <Field label="Group name" required>
            <input autoFocus value={groupName} maxLength={200} onChange={(event) => setGroupName(event.target.value)} placeholder="e.g. Berlin tech recruiters" />
          </Field>
          <p className="lead-save-note">{selectedCount} selected lead{selectedCount === 1 ? '' : 's'} will be saved. Suppressed emails are skipped automatically.</p>
          <div className="dialog-actions">
            <Button type="button" variant="secondary" disabled={save.isPending} onClick={() => setSaveOpen(false)}>Cancel</Button>
            <BusyButton type="submit" busy={save.isPending} disabled={!groupName.trim() || !selectedCount}>Save group</BusyButton>
          </div>
        </form>
      </Dialog>
    </>
  );
}
