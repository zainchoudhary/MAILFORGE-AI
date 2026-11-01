import { api } from './api';

export function reviewRows(edits, extraction) {
  return edits ?? extraction?.records ?? [];
}

export async function importReviewedRecipients(rows) {
  const selected = rows.filter((row) => row.selected !== false);
  if (!selected.length) throw new Error('Select at least one recipient to import.');
  if (selected.some((row) => !row.email?.trim())) {
    throw new Error('Each selected recipient needs an email address.');
  }
  let added = 0;
  let duplicates = 0;
  for (const { selected: checked, ...payload } of selected) {
    try {
      await api.post('/recipients', payload);
      added++;
    } catch (error) {
      if (error.response?.status === 409) duplicates++;
      else {
        throw new Error(`${added} saved before import stopped. Review and retry; existing addresses will be skipped.`);
      }
    }
  }
  return { added, duplicates };
}

export const importSummary = ({ added, duplicates }) =>
  `${added} recipient${added === 1 ? '' : 's'} added${duplicates ? `; ${duplicates} already existed` : ''}.`;
