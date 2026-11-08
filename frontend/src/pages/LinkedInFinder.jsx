import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Ban, CheckCircle2, ExternalLink, FolderPlus, History, Mail, Trash2 } from 'lucide-react';
import { useApi, useAction } from '../hooks/useApi';
import { errorText } from '../services/api';
import {
  CAPTURE_RUNS_KEY as RUNS_KEY,
  INSTALL_STEPS,
  PAGE_LIMIT,
  canCancelRun,
  cancelRun,
  deleteRun,
  deleteRuns,
  extractRun,
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
import { BusyButton, ConfirmDialog, Empty, Field, PageHeader, QueryState, Status } from '../components/Common';
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
      <td className="lead-email">
        <strong>{candidate.email}</strong>
        {candidate.existing_recipient_id && <small>Already in your recipients</small>}
      </td>
      <td>{cell('name', 'Name')}</td>
      <td>{cell('company', 'Company')}</td>
      <td>{cell('position', 'Position')}</td>
      <td>
        {candidate.source_url ? (
          <a className="lead-source" href={candidate.source_url} target="_blank" rel="noopener noreferrer" title={candidate.source_title || candidate.source_url}>
            <ExternalLink size={13} /> Post
          </a>
        ) : <small>—</small>}
      </td>
    </tr>
  );
}

export default function LinkedInFinder() {
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [activeId, setActiveId] = useState(() => params.get('run') || null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [saved, setSaved] = useState(null);
  const [selectedRunIds, setSelectedRunIds] = useState([]);
  const [deleteTarget, setDeleteTarget] = useState(null); // 'selected' | run object | null

  const jobsUrl = `${RUNS_KEY}/${activeId}/jobs?limit=${PAGE_LIMIT}`;
  const candidatesUrl = `${RUNS_KEY}/${activeId}/candidates?limit=${PAGE_LIMIT}`;
  const shouldPoll = (runValue, jobsValue) =>
    isRunLive(runValue) || hasPendingDetails(jobsValue?.items);

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
    retry: (count, error) => (error?.response?.status === 404 ? false : count < 2),
  });
  const jobs = useApi(jobsUrl, {
    enabled: !!activeId,
    refetchInterval: (query) => (shouldPoll(client.getQueryData([`${RUNS_KEY}/${activeId}`]), query.state.data) ? POLL_MS : false),
    retry: (count, error) => (error?.response?.status === 404 ? false : count < 2),
  });
  const candidates = useApi(candidatesUrl, {
    enabled: !!activeId,
    refetchInterval: () => (shouldPoll(client.getQueryData([`${RUNS_KEY}/${activeId}`]), client.getQueryData([jobsUrl])) ? POLL_MS : false),
    retry: (count, error) => (error?.response?.status === 404 ? false : count < 2),
  });

  // Deleted capture still in the URL/state → stop 404 polling.
  useEffect(() => {
    if (!activeId) return;
    const gone =
      run.error?.response?.status === 404 ||
      jobs.error?.response?.status === 404 ||
      candidates.error?.response?.status === 404;
    if (!gone) return;
    setSelectedRunIds((ids) => ids.filter((id) => id !== activeId));
    openRun(null);
    // openRun updates URL + activeId; deps intentionally omit it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, run.error, jobs.error, candidates.error]);

  const runData = run.data;
  const live = isRunLive(runData);
  const extracting = isRunExtracting(runData);
  const jobItems = jobs.data?.items || [];
  const jobsTotal = jobs.data?.total ?? jobItems.length;
  const jobsTruncated = isTruncated(jobItems.length, jobsTotal);
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
  // Overrides may still be syncing — Save as group sends explicit candidate_ids, so it can stay enabled.
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

  const extract = useAction(() => extractRun(activeId), 'Emails extracted from posts', { invalidatePrefixes: [RUNS_KEY] });
  const cancel = useAction(() => cancelRun(activeId), 'Capture cancelled — leads kept', { invalidatePrefixes: [RUNS_KEY] });
  const save = useAction(() => saveGroup(activeId, groupName.trim(), selectedIds), (data) => `Saved ${saveResultSummary(data)}`, {
    invalidatePrefixes: [RUNS_KEY, '/recipient-groups', '/recipients'],
    onSuccess: (data) => {
      setSaved(data);
      setSaveOpen(false);
      setGroupName('');
    },
  });
  const removeRuns = useAction(
    (ids) => (ids.length === 1 ? deleteRun(ids[0]) : deleteRuns(ids)),
    (data) => `Deleted ${data?.deleted || 1} capture${(data?.deleted || 1) === 1 ? '' : 's'}`,
    {
      invalidatePrefixes: [RUNS_KEY],
      onSuccess: (data, ids) => {
        const removed = new Set(data?.run_ids || ids || []);
        setSelectedRunIds((current) => current.filter((id) => !removed.has(id)));
        if (activeId && removed.has(activeId)) {
          selectionOverrides.current.clear();
          setActiveId(null);
          setSaved(null);
        }
        setDeleteTarget(null);
      },
    }
  );

  const openRun = (id) => {
    selectionOverrides.current.clear();
    setActiveId(id || null);
    setSaved(null);
    const next = new URLSearchParams(params);
    if (id) next.set('run', id);
    else next.delete('run');
    setParams(next, { replace: true });
  };

  // Extension "Open in Studio" deep-link: /lead-finder/linkedin?run=<id>
  useEffect(() => {
    const fromUrl = params.get('run');
    if (fromUrl && fromUrl !== activeId) {
      selectionOverrides.current.clear();
      setActiveId(fromUrl);
      setSaved(null);
    }
  }, [params, activeId]);

  const toggleRunSelected = (id, checked) => {
    setSelectedRunIds((current) => {
      if (checked) return current.includes(id) ? current : [...current, id];
      return current.filter((runId) => runId !== id);
    });
  };

  const runItems = runs.data?.items || [];
  const allRunsSelected = runItems.length > 0 && selectedRunIds.length === runItems.length;
  const deleteIds =
    deleteTarget === 'selected'
      ? selectedRunIds
      : deleteTarget?.id
        ? [deleteTarget.id]
        : [];

  return (
    <>
      <PageHeader
        eyebrow="AUDIENCE WORKSPACE"
        title="LinkedIn Search"
        description="Use the Chrome extension: enter keywords, Collect — it opens LinkedIn post search, auto-scrolls, and syncs public emails here. Review leads (email first) and save a recipient group."
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
                  title="Capture your first LinkedIn search"
                  description="Captures start in the Chrome extension (keyword search → Collect), not here. Once a run exists, open it from Recent captures."
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
                      <p className="lead-warning">Waiting for posts from the extension. Run Collect with search keywords.</p>
                    )}

                    <div className="lead-toolbar">
                      <div className="lead-selection-tools">
                        <span className="selection-indicator">
                          {showingLabel(jobItems.length, jobsTotal, 'post')}{jobsTruncated ? ' (among shown posts)' : ''}
                        </span>
                      </div>
                      <div className="lead-toolbar-actions">
                        {canCancelRun(runData) && (
                          <BusyButton variant="secondary" size="sm" busy={cancel.isPending} onClick={() => cancel.mutate()}>
                            <Ban size={14} /> Cancel
                          </BusyButton>
                        )}
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
                          <table className="lead-table" aria-label="Captured posts">
                            <thead>
                              <tr>
                                <th>Author</th>
                                <th>Subtitle</th>
                                <th>Post</th>
                              </tr>
                            </thead>
                            <tbody>
                              {jobItems.map((job) => (
                                <tr key={job.id}>
                                  <td>{job.title || '—'}</td>
                                  <td>{job.company || '—'}</td>
                                  <td>
                                    {job.job_url ? (
                                      <a className="lead-source" href={job.job_url} target="_blank" rel="noopener noreferrer">
                                        <ExternalLink size={13} /> Open post
                                      </a>
                                    ) : <small>—</small>}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <Empty title="No posts captured yet" description="Posts appear here as the extension captures them from LinkedIn." />
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
                                <th>Email</th>
                                <th>Name</th>
                                <th>Company</th>
                                <th>Position</th>
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
                          description={
                            extracting
                              ? 'Leads appear here once extraction finishes.'
                              : jobs.length
                                ? `Scanned ${jobs.length} LinkedIn item(s) but no emails were found in the post text. Keep hunting posts that include an email address, then they show here like Gmail Search.`
                                : 'Run Collect in the extension with search keywords. Emails found in posts appear in this table.'
                          }
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
          <div className="panel-heading">
            <div><h2><History size={14} /> Recent captures</h2></div>
          </div>
          {runItems.length > 0 && (
            <div className="lead-run-toolbar">
              <label className="lead-run-select-all">
                <input
                  type="checkbox"
                  checked={allRunsSelected}
                  onChange={(event) => {
                    setSelectedRunIds(event.target.checked ? runItems.map((item) => item.id) : []);
                  }}
                />
                Select all
              </label>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={!selectedRunIds.length || removeRuns.isPending}
                onClick={() => setDeleteTarget('selected')}
              >
                <Trash2 size={13} /> Delete{selectedRunIds.length ? ` (${selectedRunIds.length})` : ''}
              </Button>
            </div>
          )}
          <QueryState query={runs}>
            {(data) => data.items.length ? (
              <ul className="lead-run-list">
                {data.items.map((item) => (
                  <li key={item.id} className={item.id === activeId ? 'active' : ''}>
                    <label className="lead-run-check">
                      <input
                        type="checkbox"
                        aria-label={`Select ${runTitle(item)}`}
                        checked={selectedRunIds.includes(item.id)}
                        onChange={(event) => toggleRunSelected(item.id, event.target.checked)}
                      />
                    </label>
                    <button type="button" className="lead-run-open" onClick={() => openRun(item.id)}>
                      <strong>{runTitle(item)}</strong>
                      <span><StatusBadge status={item.status} /><small>{item.job_count} posts · {item.candidate_count} leads</small></span>
                    </button>
                    <button
                      type="button"
                      className="lead-run-delete"
                      aria-label={`Delete ${runTitle(item)}`}
                      disabled={removeRuns.isPending}
                      onClick={() => setDeleteTarget(item)}
                    >
                      <Trash2 size={14} />
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

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={deleteIds.length > 1 ? 'Delete selected captures' : 'Delete capture'}
        message={
          deleteIds.length > 1
            ? `This permanently deletes ${deleteIds.length} captures and their posts/leads from the database. Recipient groups already saved are kept.`
            : `This permanently deletes “${runTitle(deleteTarget !== 'selected' ? deleteTarget : null) || 'this capture'}” and its posts/leads from the database. Recipient groups already saved are kept.`
        }
        confirmLabel={deleteIds.length > 1 ? 'Delete selected' : 'Delete permanently'}
        onConfirm={() => removeRuns.mutateAsync(deleteIds)}
      />

      <Dialog open={saveOpen} onOpenChange={setSaveOpen} busy={save.isPending} title="Save as recipient group" description="Selected leads are added to your recipients and grouped for campaigns.">
        <form
          className="group-editor"
          onSubmit={(event) => {
            event.preventDefault();
            if (groupName.trim() && selectedCount) save.mutate();
          }}
        >
          <Field label="Group name" required>
            <input autoFocus value={groupName} maxLength={200} onChange={(event) => setGroupName(event.target.value)} placeholder="e.g. Berlin backend job posters" />
          </Field>
          <p className="lead-save-note">
            {selectedCount} selected lead{selectedCount === 1 ? '' : 's'} will be saved.
            {selectionPending ? ' Finishing selection sync…' : ''} Suppressed emails are skipped automatically.
          </p>
          <div className="dialog-actions">
            <Button type="button" variant="secondary" disabled={save.isPending} onClick={() => setSaveOpen(false)}>Cancel</Button>
            <BusyButton type="submit" busy={save.isPending} disabled={!groupName.trim() || !selectedCount}>Save group</BusyButton>
          </div>
        </form>
      </Dialog>
    </>
  );
}
