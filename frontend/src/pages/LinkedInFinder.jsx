import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle2, ExternalLink, FolderPlus } from 'lucide-react';
import { useApi, useAction } from '../hooks/useApi';
import { errorText } from '../services/api';
import {
  CAPTURE_RUNS_KEY as RUNS_KEY,
  PAGE_LIMIT,
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

const StatusBadge = ({ status }) => <Status value={status} />;

// Keep in sync with the "Extracted leads" <thead> column count.
const LEAD_TABLE_COLS = 8;

function postedLabel(candidate) {
  const signals = candidate?.signals || {};
  return signals.posted_at_text || signals.posted_at || '';
}

function postBody(candidate) {
  const signals = candidate?.signals || {};
  return signals.post_body || candidate?.snippet || '';
}

/** Permalink for the LinkedIn post this lead came from (never the search-results page). */
function postUrl(candidate) {
  const signals = candidate?.signals || {};
  const raw = String(candidate?.source_url || signals.post_url || '').trim();
  if (!raw) return '';
  // Hide search-result / junk links so "Go to post" never opens a dead page by mistake.
  if (/\/search\/results\//i.test(raw) || /\/jobs\/search/i.test(raw)) return '';
  if (!/linkedin\.com\/(?:posts\/|feed\/update\/)/i.test(raw)) return '';
  return raw;
}

function CandidateRow({ runId, candidate, onChanged, onSelect }) {
  const [open, setOpen] = useState(false);
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
  const when = postedLabel(candidate);
  const body = postBody(candidate);
  const url = postUrl(candidate);
  return (
    <>
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
        <td>{cell('position', 'Designation')}</td>
        <td className="lead-posted">{when || '—'}</td>
        <td>
          {url ? (
            <a
              className="lead-source"
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              title={candidate.source_title || url}
            >
              <ExternalLink size={13} /> Go to post
            </a>
          ) : (
            <small>—</small>
          )}
        </td>
        <td>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            aria-expanded={open}
            aria-label={`${open ? 'Hide' : 'View'} post for ${candidate.email}`}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? 'Hide' : 'View post'}
          </Button>
        </td>
      </tr>
      {open && (
        <tr className="lead-post-expand">
          <td colSpan={LEAD_TABLE_COLS}>
            <div className="lead-post-meta">
              <div><strong>Poster:</strong> {candidate.name || '—'}</div>
              <div><strong>Designation:</strong> {candidate.position || '—'}</div>
              <div><strong>Posted:</strong> {when || '—'}</div>
            </div>
            <div className="lead-post-body">{body || 'No post text saved for this lead. Run a fresh Collect after reloading the extension.'}</div>
            {url ? (
              <div className="lead-post-actions">
                <a className="lead-go-post" href={url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink size={14} />
                  Go to post
                </a>
              </div>
            ) : null}
          </td>
        </tr>
      )}
    </>
  );
}

export default function LinkedInFinder() {
  const client = useQueryClient();
  const navigate = useNavigate();
  const { runId: routeRunId } = useParams();
  const [params] = useSearchParams();
  const legacyRun = params.get('run');
  const activeId = routeRunId || null;
  const [saveOpen, setSaveOpen] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [saved, setSaved] = useState(null);

  const jobsUrl = `${RUNS_KEY}/${activeId}/jobs?limit=${PAGE_LIMIT}`;
  const candidatesUrl = `${RUNS_KEY}/${activeId}/candidates?limit=${PAGE_LIMIT}`;
  const shouldPoll = (runValue, jobsValue) =>
    isRunLive(runValue) || hasPendingDetails(jobsValue?.items);

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

  // Deleted / missing capture → return to listing.
  useEffect(() => {
    if (!activeId) return;
    const gone =
      run.error?.response?.status === 404 ||
      jobs.error?.response?.status === 404 ||
      candidates.error?.response?.status === 404;
    if (!gone) return;
    navigate('/lead-finder/linkedin', { replace: true });
  }, [activeId, run.error, jobs.error, candidates.error, navigate]);

  const runData = run.data;
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

  const save = useAction(() => saveGroup(activeId, groupName.trim(), selectedIds), (data) => `Saved ${saveResultSummary(data)}`, {
    invalidatePrefixes: [RUNS_KEY, '/recipient-groups', '/recipients'],
    onSuccess: (data) => {
      setSaved(data);
      setSaveOpen(false);
      setGroupName('');
    },
  });

  // Legacy deep-link: /lead-finder/linkedin?run=<id> → /lead-finder/linkedin/<id>
  if (!routeRunId && legacyRun) {
    return <Navigate to={`/lead-finder/linkedin/${legacyRun}`} replace />;
  }
  if (!activeId) {
    return <Navigate to="/lead-finder/linkedin" replace />;
  }

  return (
    <>
      <PageHeader
        eyebrow="OUTREACH INTELLIGENCE"
        title={runTitle(runData) || 'LinkedIn capture'}
        description="Review leads from this capture, then save a recipient group."
        backTo="/lead-finder/linkedin"
        backLabel="Back to captures"
      />

      <div className="lead-detail">
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
                          {extracting ? ' · Extracting emails…' : ''}
                        </span>
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
                                <th>Designation</th>
                                <th>Posted</th>
                                <th>Source</th>
                                <th><span className="sr-only">Post text</span></th>
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
      </div>

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
