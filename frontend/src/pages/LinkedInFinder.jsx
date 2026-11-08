import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Ban, CheckCircle2, DownloadCloud, ExternalLink, FolderPlus, History, Mail } from 'lucide-react';
import { useApi, useAction } from '../hooks/useApi';
import { errorText } from '../services/api';
import {
  CAPTURE_RUNS_KEY as RUNS_KEY,
  INSTALL_STEPS,
  PAGE_LIMIT,
  canCancelRun,
  cancelRun,
  detailCounts,
  extractRun,
  fetchJobDetails,
  hasPendingDetails,
  isRunExtracting,
  isRunLive,
  isTruncated,
  patchCandidate,
  progressLine,
  runTitle,
  saveGroup,
  saveResultSummary,
  setCandidatesSelected,
  showingLabel,
} from '../services/linkedinCapture';
import { BusyButton, Empty, Field, PageHeader, QueryState, Status } from '../components/Common';
import { Button } from '../components/ui/button';
import { Dialog } from '../components/ui/dialog';

const POLL_MS = 3000;
const RUNS_IDLE_POLL_MS = 15000;

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
      value={draft[field] || ''}
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
            <ExternalLink size={13} /> Job post
          </a>
        ) : <small>—</small>}
      </td>
    </tr>
  );
}

export default function LinkedInFinder() {
  const client = useQueryClient();
  const [activeId, setActiveId] = useState(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [saved, setSaved] = useState(null);

  // Jobs keep changing after the run leaves idle/extracting: the extension fills in details
  // for pending jobs, and a fetch-details request may not have flipped statuses yet.
  const detailsRequested = useRef(false);
  const jobsUrl = `${RUNS_KEY}/${activeId}/jobs?limit=${PAGE_LIMIT}`;
  const candidatesUrl = `${RUNS_KEY}/${activeId}/candidates?limit=${PAGE_LIMIT}`;
  const shouldPoll = (runValue, jobsValue) =>
    isRunLive(runValue) || hasPendingDetails(jobsValue?.items) || detailsRequested.current;

  const runs = useApi(RUNS_KEY, {
    refetchInterval: (query) => {
      const items = query.state.data?.items;
      if (items?.some(isRunExtracting)) return POLL_MS;
      if (activeId) return shouldPoll(client.getQueryData([`${RUNS_KEY}/${activeId}`]), client.getQueryData([jobsUrl])) ? POLL_MS : false;
      // Empty state: light poll so captures started in the extension show up.
      return RUNS_IDLE_POLL_MS;
    },
  });
  const run = useApi(`${RUNS_KEY}/${activeId}`, {
    enabled: !!activeId,
    refetchInterval: (query) => (shouldPoll(query.state.data, client.getQueryData([jobsUrl])) ? POLL_MS : false),
  });
  const jobs = useApi(jobsUrl, {
    enabled: !!activeId,
    refetchInterval: (query) => (shouldPoll(client.getQueryData([`${RUNS_KEY}/${activeId}`]), query.state.data) ? POLL_MS : false),
  });
  const candidates = useApi(candidatesUrl, {
    enabled: !!activeId,
    refetchInterval: () => (shouldPoll(client.getQueryData([`${RUNS_KEY}/${activeId}`]), client.getQueryData([jobsUrl])) ? POLL_MS : false),
  });

  const runData = run.data;
  const live = isRunLive(runData);
  const extracting = isRunExtracting(runData);
  const jobItems = jobs.data?.items || [];
  const counts = detailCounts(jobItems);
  const jobsTotal = jobs.data?.total ?? jobItems.length;
  const jobsTruncated = isTruncated(jobItems.length, jobsTotal);
  // Stop the post-request poll once the server reports nothing pending.
  useEffect(() => {
    if (detailsRequested.current && jobs.data && counts.pending === 0) detailsRequested.current = false;
  });

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
  const candidatesTotal = candidates.data?.total ?? items.length;
  const candidatesTruncated = isTruncated(items.length, candidatesTotal);
  const selectedIds = items.filter((candidate) => candidate.selected).map((candidate) => candidate.id);
  const selectedCount = selectedIds.length;
  // Selection PATCHes still in flight: saving now could miss them server-side.
  const selectionPending = selectionOverrides.current.size > 0;
  const allSelected = items.length > 0 && selectedCount === items.length;
  const someSelected = selectedCount > 0 && !allSelected;
  const refreshRunViews = () => client.invalidateQueries({ predicate: (query) => typeof query.queryKey[0] === 'string' && query.queryKey[0].startsWith(RUNS_KEY) });
  const selectAllRef = useRef(null);
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someSelected;
  }, [someSelected, allSelected, items.length]);

  /** Instant UI; PATCH in background. */
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

    const resync = (error, failed, total) => {
      for (const id of ids) selectionOverrides.current.delete(id);
      setSelectionTick((tick) => tick + 1);
      void client.invalidateQueries({ queryKey: [candidatesUrl], refetchType: 'active' });
      void client.invalidateQueries({ queryKey: [RUNS_KEY], refetchType: 'active' });
      toast.error(`${failed} of ${total} updates failed — refreshed from server. ${errorText(error)}`);
    };
    const rollback = (error) => {
      for (const id of ids) selectionOverrides.current.delete(id);
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
      void client.invalidateQueries({ queryKey: [candidatesUrl], refetchType: 'active' });
    };

    void (async () => {
      try {
        if (targets.length === 1) await patchCandidate(activeId, targets[0].id, { selected });
        else {
          const result = await setCandidatesSelected(activeId, targets, selected);
          if (result.failed) {
            // Server is now mixed: trust it rather than rolling back the whole UI.
            resync(result.errors[0], result.failed, targets.length);
            return;
          }
        }
        for (const id of ids) {
          if (selectionOverrides.current.get(id) === selected) selectionOverrides.current.delete(id);
        }
        setSelectionTick((tick) => tick + 1);
      } catch (error) {
        // Single PATCH failed; the server still has the old value.
        rollback(error);
      }
    })();
  };

  const toggleSelectAll = (selected) => {
    setSelection(items.map((candidate) => candidate.id), selected);
  };

  // When extraction finishes, pull in the final candidate list once.
  const [wasExtracting, setWasExtracting] = useState(false);
  useEffect(() => {
    if (wasExtracting && !extracting) refreshRunViews();
    setWasExtracting(extracting);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extracting]);

  const fetchDetails = useAction(() => fetchJobDetails(activeId), 'Detail fetch requested — keep the extension open', {
    invalidatePrefixes: [RUNS_KEY],
    onConfirmed: () => { detailsRequested.current = true; },
  });
  const extract = useAction(() => extractRun(activeId), 'Emails extracted from job posts', { invalidatePrefixes: [RUNS_KEY] });
  const cancel = useAction(() => cancelRun(activeId), 'Capture cancelled — leads kept', { invalidatePrefixes: [RUNS_KEY] });
  const save = useAction(() => saveGroup(activeId, groupName.trim(), selectedIds), (data) => `Saved ${saveResultSummary(data)}`, {
    invalidatePrefixes: [RUNS_KEY, '/recipient-groups', '/recipients'],
    onSuccess: (data) => {
      setSaved(data);
      setSaveOpen(false);
      setGroupName('');
    },
  });

  const openRun = (id) => {
    selectionOverrides.current.clear();
    detailsRequested.current = false;
    setActiveId(id);
    setSaved(null);
  };

  const needsDetails = counts.pending + counts.failed;

  return (
    <>
      <PageHeader
        eyebrow="AUDIENCE WORKSPACE"
        title="LinkedIn Search"
        description="Capture LinkedIn Jobs with the Outreach Studio Chrome extension, pull emails from the job posts, then review and save leads as a recipient group."
      />

      <div className="lead-layout">
        <div className="lead-main">
          {!activeId ? (
            <section className="panel">
              {runs.data?.items?.length ? (
                <Empty
                  title="Select a capture to review"
                  description="Open a run from Recent captures to see its jobs and leads. New captures from the extension appear there automatically."
                />
              ) : (
                <Empty
                  title="Capture your first LinkedIn Jobs search"
                  description="Captures start in the Chrome extension, not here. Once a run exists, open it from Recent captures."
                  action={(
                    <ol className="lead-install-steps">
                      {INSTALL_STEPS.map((step) => <li key={step}>{step}</li>)}
                    </ol>
                  )}
                />
              )}
            </section>
          ) : (
            <section className="panel">
              <QueryState query={run}>
                {() => (
                  <>
                    <div className="panel-heading">
                      <div>
                        <h2 className="lead-run-title">{runTitle(runData)}</h2>
                        <p>{progressLine(runData)}</p>
                      </div>
                      <StatusBadge status={runData.status} />
                    </div>
                    {runData.status === 'failed' && (
                      <div className="error-panel lead-error" role="alert">
                        <h3>Email extraction couldn’t finish</h3>
                        <p>{runData.error || runData.progress?.message || 'Something went wrong while extracting emails.'}</p>
                      </div>
                    )}
                    {runData.status === 'idle' && jobItems.length === 0 && (
                      <p className="lead-warning">Waiting for jobs from the extension. Start a capture on a LinkedIn Jobs search page.</p>
                    )}

                    <div className="lead-toolbar">
                      <div className="lead-selection-tools">
                        <span className="selection-indicator">
                          {showingLabel(jobItems.length, jobsTotal, 'job')} · {counts.fetched} with details{needsDetails ? ` · ${needsDetails} need details` : ''}{jobsTruncated ? ' (among shown jobs)' : ''}
                        </span>
                      </div>
                      <div className="lead-toolbar-actions">
                        {canCancelRun(runData) && (
                          <BusyButton variant="secondary" size="sm" busy={cancel.isPending} onClick={() => cancel.mutate()}>
                            <Ban size={14} /> Cancel
                          </BusyButton>
                        )}
                        <BusyButton
                          variant="secondary"
                          size="sm"
                          busy={fetchDetails.isPending}
                          disabled={runData.status === 'cancelled' || (needsDetails === 0 && !jobsTruncated)}
                          onClick={() => fetchDetails.mutate()}
                        >
                          <DownloadCloud size={14} /> Fetch job details
                        </BusyButton>
                        <BusyButton
                          size="sm"
                          busy={extract.isPending || extracting}
                          disabled={runData.status === 'cancelled' || jobItems.length === 0}
                          onClick={() => extract.mutate()}
                        >
                          <Mail size={14} /> Extract emails from posts
                        </BusyButton>
                      </div>
                    </div>

                    <QueryState query={jobs}>
                      {() => jobItems.length ? (
                        <div className="table-scroll">
                          <table className="lead-table" aria-label="Captured jobs">
                            <thead>
                              <tr>
                                <th>Title</th>
                                <th>Company</th>
                                <th>Location</th>
                                <th>Details</th>
                                <th>Job</th>
                              </tr>
                            </thead>
                            <tbody>
                              {jobItems.map((job) => (
                                <tr key={job.id}>
                                  <td>{job.title || '—'}</td>
                                  <td>{job.company || '—'}</td>
                                  <td>{job.location || '—'}</td>
                                  <td><StatusBadge status={job.detail_status} /></td>
                                  <td>
                                    {job.job_url ? (
                                      <a className="lead-source" href={job.job_url} target="_blank" rel="noopener noreferrer">
                                        <ExternalLink size={13} /> Open
                                      </a>
                                    ) : <small>—</small>}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <Empty title="No jobs captured yet" description="Jobs appear here as the extension captures them from LinkedIn." />
                      )}
                    </QueryState>

                    <div className="lead-toolbar">
                      <div className="lead-selection-tools">
                        <span className="selection-indicator">{selectedCount} selected · {showingLabel(items.length, candidatesTotal, 'lead')}{candidatesTruncated ? ' (selection applies to shown leads only)' : ''}</span>
                        {items.length > 0 && (
                          <>
                            <Button type="button" variant="secondary" size="sm" disabled={allSelected} onClick={() => toggleSelectAll(true)}>
                              {candidatesTruncated ? `Select shown (${items.length})` : 'Select all'}
                            </Button>
                            <Button type="button" variant="secondary" size="sm" disabled={selectedCount === 0} onClick={() => toggleSelectAll(false)}>
                              Clear
                            </Button>
                          </>
                        )}
                      </div>
                      <div className="lead-toolbar-actions">
                        <Button size="sm" disabled={!selectedCount || selectionPending} onClick={() => setSaveOpen(true)}>
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
                          <table className="lead-table" aria-label="Extracted leads">
                            <thead>
                              <tr>
                                <th className="table-check">
                                  <input
                                    ref={selectAllRef}
                                    type="checkbox"
                                    aria-label={candidatesTruncated ? 'Select all shown leads' : 'Select all leads'}
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
                          title={extracting ? 'Extracting…' : 'No leads extracted yet'}
                          description={extracting ? 'Leads appear here once extraction finishes.' : 'Fetch job details, then extract emails from the posts.'}
                        />
                      )}
                    </QueryState>
                  </>
                )}
              </QueryState>
            </section>
          )}
        </div>

        <aside className="panel lead-runs" aria-label="Recent captures">
          <div className="panel-heading"><div><h2><History size={14} /> Recent captures</h2></div></div>
          <QueryState query={runs}>
            {(data) => data.items.length ? (
              <ul className="lead-run-list">
                {data.items.map((item) => (
                  <li key={item.id}>
                    <button type="button" className={item.id === activeId ? 'active' : ''} onClick={() => openRun(item.id)}>
                      <strong>{runTitle(item)}</strong>
                      <span><StatusBadge status={item.status} /><small>{item.job_count} jobs · {item.candidate_count} leads</small></span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <>
                <p className="lead-runs-empty">No captures yet.</p>
                {!activeId && <small className="lead-runs-empty">Install the extension and start a capture.</small>}
              </>
            )}
          </QueryState>
        </aside>
      </div>

      <Dialog open={saveOpen} onOpenChange={setSaveOpen} busy={save.isPending} title="Save as recipient group" description="Selected leads are added to your recipients and grouped for campaigns.">
        <form
          className="group-editor"
          onSubmit={(event) => {
            event.preventDefault();
            if (groupName.trim() && !selectionPending) save.mutate();
          }}
        >
          <Field label="Group name" required>
            <input autoFocus value={groupName} maxLength={200} onChange={(event) => setGroupName(event.target.value)} placeholder="e.g. Berlin backend job posters" />
          </Field>
          <p className="lead-save-note">{selectedCount} selected lead{selectedCount === 1 ? '' : 's'} will be saved. Suppressed emails are skipped automatically.</p>
          <div className="dialog-actions">
            <Button type="button" variant="secondary" disabled={save.isPending} onClick={() => setSaveOpen(false)}>Cancel</Button>
            <BusyButton type="submit" busy={save.isPending} disabled={!groupName.trim() || !selectedCount || selectionPending}>Save group</BusyButton>
          </div>
        </form>
      </Dialog>
    </>
  );
}
