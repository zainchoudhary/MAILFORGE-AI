import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useLocation, useNavigate } from 'react-router-dom';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { FolderPlus, UsersRound, Pencil, Trash2, Search, Check, ListPlus, ListChecks, Eye, Mail, Building2 } from 'lucide-react';
import { useApi, useAction } from '../hooks/useApi';
import { api } from '../services/api';
import { BusyButton, ConfirmDialog, Empty, Field, PageHeader, QueryState } from '../components/Common';
import { Button } from '../components/ui/button';
import { Dialog } from '../components/ui/dialog';
import { getGroupPreviewMembers } from '../services/recipientGroups';

const schema = z.object({ name: z.string().trim().min(1, 'Group name is required').max(200) });

export default function RecipientGroups() {
  const location = useLocation();
  const navigate = useNavigate();
  const groups = useApi('/recipient-groups');
  const recipients = useApi('/recipients?limit=100');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [search, setSearch] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [previewTarget, setPreviewTarget] = useState(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedGroupIds, setSelectedGroupIds] = useState([]);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const form = useForm({ resolver: zodResolver(schema), defaultValues: { name: '' } });
  const availableRecipients = recipients.data?.items || [];
  const groupCount = groups.data?.items.length || 0;
  const savedMemberships = groups.data?.items.reduce((total, group) => total + group.recipient_count, 0) || 0;
  const visibleRecipients = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return availableRecipients;
    return availableRecipients.filter((recipient) => `${recipient.name} ${recipient.email}`.toLowerCase().includes(term));
  }, [availableRecipients, search]);
  const openEditor = (group = null) => {
    setEditing(group);
    setSelectedIds(group?.recipient_ids || []);
    setSearch('');
    form.reset({ name: group?.name || '' });
    setOpen(true);
  };
  const save = useAction(async ({ name }) => {
    const payload = { name: name.trim(), recipient_ids: selectedIds };
    return editing
      ? (await api.put(`/recipient-groups/${editing.id}`, payload)).data
      : (await api.post('/recipient-groups', payload)).data;
  }, (data) => `“${data.name}” saved`, {
    invalidatePrefixes: ['/recipient-groups'],
    onSuccess: () => setOpen(false),
  });
  const remove = useAction((id) => api.delete(`/recipient-groups/${id}`), 'Recipient group deleted', {
    invalidatePrefixes: ['/recipient-groups'],
    onSuccess: () => setDeleteTarget(null),
  });
  const bulkRemove = useAction(
    async (ids) => (await api.post('/recipient-groups/bulk-delete', { group_ids: ids })).data,
    (data) => `Deleted ${data.deleted} group${data.deleted === 1 ? '' : 's'}`,
    {
      invalidatePrefixes: ['/recipient-groups'],
      onSuccess: () => {
        setSelectedGroupIds([]);
        setSelectionMode(false);
        setBulkDeleteOpen(false);
      },
    },
  );
  useEffect(() => {
    if (!open) form.clearErrors();
  }, [open, form]);
  useEffect(() => {
    const groupId = location.state?.openGroupId;
    const group = groups.data?.items?.find((item) => item.id === groupId);
    if (group) {
      openEditor(group);
      navigate('/recipient-groups', { replace: true, state: null });
    }
  }, [groups.data, location.state, navigate]);
  const toggleRecipient = (id) => setSelectedIds((current) => current.includes(id)
    ? current.filter((recipientId) => recipientId !== id)
    : [...current, id]);
  const visibleIds = visibleRecipients.map((recipient) => recipient.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));
  return (
    <>
      <PageHeader
        eyebrow="AUDIENCE WORKSPACE"
        title="Recipient groups"
        description="Build saved broadcast lists from contacts in this private workspace."
      >
        <Button onClick={() => openEditor()}><FolderPlus size={16} /> Create group</Button>
      </PageHeader>
      <div className="group-library-context" aria-label="Recipient group summary">
        <div><span className="group-library-icon"><UsersRound size={16} /></span><p><strong>Broadcast lists</strong><small>Saved audiences ready for campaign selection.</small></p></div>
        <div className="group-library-stats"><span><strong>{groupCount}</strong> groups</span><span><strong>{savedMemberships}</strong> memberships</span></div>
      </div>
      {groupCount > 0 && (
        <div className="group-library-toolbar">
          {selectionMode && <span className="selection-indicator"><ListChecks size={15} /> {selectedGroupIds.length} selected</span>}
          <Button
            variant={selectionMode ? 'default' : 'secondary'}
            size="sm"
            onClick={() => {
              setSelectionMode((active) => !active);
              if (selectionMode) setSelectedGroupIds([]);
            }}
          >
            <ListChecks size={14} />
            {selectionMode ? 'Cancel' : 'Select multiple'}
          </Button>
          {selectionMode && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                const pageIds = groups.data?.items?.map((group) => group.id) || [];
                const allSelected = pageIds.length > 0 && pageIds.every((id) => selectedGroupIds.includes(id));
                setSelectedGroupIds(allSelected
                  ? selectedGroupIds.filter((id) => !pageIds.includes(id))
                  : [...new Set([...selectedGroupIds, ...pageIds])]);
              }}
            >
              {groups.data?.items?.length > 0 && groups.data.items.every((group) => selectedGroupIds.includes(group.id))
                ? 'Deselect all'
                : 'Select all'}
            </Button>
          )}
          {selectionMode && selectedGroupIds.length > 0 && (
            <Button variant="destructive" size="sm" onClick={() => setBulkDeleteOpen(true)}>
              <Trash2 size={14} />
              Delete {selectedGroupIds.length} selected
            </Button>
          )}
        </div>
      )}
      <QueryState query={groups}>
        {(data) => data.items.length ? (
          <section className="groups-grid">
            {data.items.map((group) => {
              const selected = selectedGroupIds.includes(group.id);
              return (
              <article className={`group-card${selectionMode && selected ? ' selected' : ''}`} key={group.id}>
                {selectionMode && (
                  <label className="group-card-check">
                    <input
                      type="checkbox"
                      aria-label={`Select ${group.name}`}
                      checked={selected}
                      onChange={(event) => setSelectedGroupIds((current) => (event.target.checked
                        ? [...new Set([...current, group.id])]
                        : current.filter((id) => id !== group.id)))}
                    />
                  </label>
                )}
                <div className="group-card-icon"><UsersRound size={19} /></div>
                <div className="group-card-content"><h3>{group.name}</h3><p>{group.recipient_count} {group.recipient_count === 1 ? 'recipient' : 'recipients'} saved</p></div>
                <div className="group-card-actions">
                  <Button variant="ghost" size="icon" aria-label={`Preview ${group.name}`} onClick={() => setPreviewTarget(group)}><Eye size={15} /></Button>
                  <Button variant="ghost" size="icon" aria-label={`Edit ${group.name}`} onClick={() => openEditor(group)}><Pencil size={15} /></Button>
                  <Button variant="ghost" size="icon" aria-label={`Delete ${group.name}`} onClick={() => setDeleteTarget(group)}><Trash2 size={15} /></Button>
                </div>
                <div className="group-card-members"><span><Check size={13} /> Ready for campaign selection</span><small>Updated {new Date(group.created_at).toLocaleDateString()}</small></div>
              </article>
              );
            })}
          </section>
        ) : <Empty title="Create your first recipient group" description="Select multiple contacts once, then reuse the group whenever you prepare a campaign." action={<Button onClick={() => openEditor()}><ListPlus size={16} /> Create group</Button>} />}
      </QueryState>
      <Dialog open={open} onOpenChange={setOpen} busy={save.isPending} title={editing ? 'Edit recipient group' : 'Create recipient group'} description="Choose the contacts that belong in this saved broadcast list.">
        <form className="group-editor" onSubmit={form.handleSubmit((values) => save.mutate(values))}>
          <Field label="Group name" required error={form.formState.errors.name}><input autoFocus placeholder="e.g. Product launch invitees" {...form.register('name')} /></Field>
          <div className="group-member-heading"><div><strong>Recipients <em>*</em></strong><small>Select at least 2 saved recipients.</small></div><span>{selectedIds.length} selected</span></div>
          <div className="group-recipient-search"><Search size={15} /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search saved recipients" aria-label="Search saved recipients" /></div>
          <div className="group-selection-tools"><small>{visibleRecipients.length} recipients</small><Button type="button" variant="secondary" size="sm" disabled={!visibleIds.length} onClick={() => setSelectedIds((current) => allVisibleSelected ? current.filter((id) => !visibleIds.includes(id)) : [...new Set([...current, ...visibleIds])])}>{allVisibleSelected ? 'Clear selection' : 'Select all'}</Button></div>
          <div className="group-recipient-list" aria-label="Recipient selection">
            {visibleRecipients.map((recipient) => {
              const selected = selectedIds.includes(recipient.id);
              const displayName = recipient.name || recipient.email;
              return <label className={selected ? 'selected' : ''} key={recipient.id}><input type="checkbox" checked={selected} onChange={() => toggleRecipient(recipient.id)} /><span className="group-recipient-avatar">{displayName.slice(0, 1).toUpperCase()}</span><span><strong>{displayName}</strong><small>{recipient.email}</small></span></label>;
            })}
            {!visibleRecipients.length && <p className="group-no-results">No saved recipients match this search.</p>}
          </div>
          {selectedIds.length < 2 && <p className="group-selection-error">Choose at least 2 recipients to save this group.</p>}
          <div className="dialog-actions"><Button type="button" variant="secondary" disabled={save.isPending} onClick={() => setOpen(false)}>Cancel</Button><BusyButton type="submit" busy={save.isPending} disabled={selectedIds.length < 2}>{editing ? 'Save group' : 'Create group'}</BusyButton></div>
        </form>
      </Dialog>
      <ConfirmDialog open={!!deleteTarget} onOpenChange={(value) => !value && setDeleteTarget(null)} title="Delete recipient group" itemLabel={deleteTarget?.name} message={<>Delete <strong>{deleteTarget?.name}</strong>? Contacts stay in your library; only this saved group is removed.</>} confirmLabel="Delete group" processingLabel="Deleting group…" onConfirm={() => remove.mutateAsync(deleteTarget.id)} />
      <ConfirmDialog
        open={bulkDeleteOpen}
        onOpenChange={setBulkDeleteOpen}
        title="Delete selected groups"
        message={<p>This will remove {selectedGroupIds.length} saved group{selectedGroupIds.length === 1 ? '' : 's'}. Contacts stay in your library.</p>}
        confirmLabel="Delete selected"
        onConfirm={() => bulkRemove.mutateAsync(selectedGroupIds)}
      />
      <Dialog open={!!previewTarget} onOpenChange={(value) => !value && setPreviewTarget(null)} title={previewTarget ? `${previewTarget.name} members` : 'Recipient group preview'} description="A read-only view of the people in this saved recipient group.">
        <div className="group-preview" aria-label="Recipient group members">
          <div className="group-preview-summary"><span><UsersRound size={16} /></span><div><strong>{previewTarget?.recipient_count || 0} saved members</strong><small>Member details are private to this workspace.</small></div></div>
          {(() => {
            const members = getGroupPreviewMembers(previewTarget);
            return members.length ? <div className="group-preview-members">{members.map((member) => <article key={member.id}><span className="group-recipient-avatar">{(member.name || member.email).slice(0, 1).toUpperCase()}</span><div><strong>{member.name || member.email}</strong><small><Mail size={12} /> {member.email}</small>{(member.company || member.position) && <small><Building2 size={12} /> {[member.company, member.position].filter(Boolean).join(' · ')}</small>}</div></article>)}</div> : <Empty title="No members available" description="This group has no active recipients to preview." />;
          })()}
        </div>
      </Dialog>
    </>
  );
}
