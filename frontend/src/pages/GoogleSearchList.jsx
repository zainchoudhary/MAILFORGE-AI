import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, RefreshCw, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useApi, useAction } from '../hooks/useApi';
import { deleteRun, deleteRuns } from '../services/leadFinder';
import { ConfirmDialog, Empty, PageHeader, QueryState, Status, dateLabel } from '../components/Common';
import { Button } from '../components/ui/button';

const RUNS_KEY = '/lead-finder/runs';

export default function GoogleSearchList() {
  const [q, setQ] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [selectionMode, setSelectionMode] = useState(false);

  const runs = useApi(RUNS_KEY, { refetchInterval: 8000 });
  const items = runs.data?.items || [];
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((run) => String(run.instruction || '').toLowerCase().includes(needle));
  }, [items, q]);

  const remove = useAction(
    (ids) => (ids.length === 1 ? deleteRun(ids[0]) : deleteRuns(ids)),
    (data) => `Deleted ${data?.deleted || 1} search${(data?.deleted || 1) === 1 ? '' : 'es'}`,
    {
      invalidatePrefixes: [RUNS_KEY],
      onSuccess: () => {
        setDeleteTarget(null);
        setSelectedIds([]);
        setSelectionMode(false);
      },
    }
  );

  const deleteIds =
    deleteTarget === 'selected'
      ? selectedIds
      : deleteTarget?.id
        ? [deleteTarget.id]
        : [];

  const deleteTitle =
    deleteTarget !== 'selected' ? deleteTarget?.instruction || 'this search' : '';

  return (
    <>
      <PageHeader
        eyebrow="OUTREACH INTELLIGENCE"
        title="Google Search"
        description="Past lead searches — open a run to review emails, then save a recipient group."
      >
        <Button
          variant="secondary"
          size="sm"
          aria-label="Refresh searches"
          title="Refresh"
          disabled={runs.isFetching}
          onClick={() => {
            runs.refetch().then(() => toast.success('Searches refreshed'));
          }}
        >
          <RefreshCw size={15} className={runs.isFetching ? 'animate-spin' : ''} />
          Refresh
        </Button>
        <Button size="sm" asChild>
          <Link to="/lead-finder/gmail/new">
            <Search size={15} />
            New search
          </Link>
        </Button>
      </PageHeader>

      <section className="panel">
        <div className="filter-bar">
          <div className="search-input">
            <Search size={16} />
            <input
              placeholder="Search past runs…"
              value={q}
              onChange={(event) => setQ(event.target.value)}
            />
          </div>
          {items.length > 0 && (
            <Button
              variant={selectionMode ? 'default' : 'secondary'}
              size="sm"
              onClick={() => {
                setSelectionMode((active) => !active);
                if (selectionMode) setSelectedIds([]);
              }}
            >
              {selectionMode ? 'Cancel' : 'Select multiple'}
            </Button>
          )}
          {selectionMode && filtered.length > 0 && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                const pageIds = filtered.map((run) => run.id);
                const allSelected = pageIds.every((id) => selectedIds.includes(id));
                setSelectedIds(
                  allSelected
                    ? selectedIds.filter((id) => !pageIds.includes(id))
                    : [...new Set([...selectedIds, ...pageIds])]
                );
              }}
            >
              {filtered.every((run) => selectedIds.includes(run.id)) ? 'Deselect all' : 'Select all'}
            </Button>
          )}
          {selectionMode && selectedIds.length > 0 && (
            <Button variant="destructive" size="sm" onClick={() => setDeleteTarget('selected')}>
              <Trash2 size={14} />
              Delete {selectedIds.length} selected
            </Button>
          )}
        </div>

        <QueryState query={runs}>
          {() =>
            filtered.length ? (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      {selectionMode && <th className="table-check" aria-label="Selection" />}
                      <th>Search</th>
                      <th>Status</th>
                      <th>Leads</th>
                      <th>Created</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((run) => {
                      const title = run.instruction || 'Google search';
                      return (
                        <tr key={run.id}>
                          {selectionMode && (
                            <td className="table-check">
                              <input
                                type="checkbox"
                                aria-label={`Select ${title}`}
                                checked={selectedIds.includes(run.id)}
                                onChange={(event) =>
                                  setSelectedIds((current) =>
                                    event.target.checked
                                      ? [...new Set([...current, run.id])]
                                      : current.filter((id) => id !== run.id)
                                  )
                                }
                              />
                            </td>
                          )}
                          <td>
                            <Link className="table-title" to={`/lead-finder/gmail/${run.id}`}>
                              {title}
                            </Link>
                          </td>
                          <td>
                            <Status value={run.status} />
                          </td>
                          <td>{run.candidate_count ?? 0}</td>
                          <td>{dateLabel(run.created_at)}</td>
                          <td>
                            <div className="flex gap-2">
                              <Link to={`/lead-finder/gmail/${run.id}`} aria-label={`Open ${title}`}>
                                <ArrowUpRight size={18} />
                              </Link>
                              <button
                                type="button"
                                aria-label={`Delete ${title}`}
                                onClick={() => setDeleteTarget(run)}
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty
                title={q.trim() ? 'No matching searches' : 'No Google searches yet'}
                description={
                  q.trim()
                    ? 'Try a different search term.'
                    : 'Start a new search to find public recruiter emails.'
                }
                action={
                  !q.trim() ? (
                    <Button asChild>
                      <Link to="/lead-finder/gmail/new">
                        <Search size={15} /> New search
                      </Link>
                    </Button>
                  ) : null
                }
              />
            )
          }
        </QueryState>
      </section>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={deleteIds.length > 1 ? 'Delete selected searches' : 'Delete search'}
        message={
          deleteIds.length > 1
            ? `This permanently deletes ${deleteIds.length} searches and their leads. Recipient groups already saved are kept.`
            : `This permanently deletes “${deleteTitle}” and its leads. Recipient groups already saved are kept.`
        }
        confirmLabel={deleteIds.length > 1 ? 'Delete selected' : 'Delete permanently'}
        onConfirm={() => remove.mutateAsync(deleteIds)}
      />
    </>
  );
}
