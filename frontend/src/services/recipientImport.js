import { api } from './api';

export function reviewRows(edits, extraction) {
  return edits ?? extraction?.records ?? [];
}

// An Excel upload is immediately handed to the extraction worker. Keeping this
// small transition here makes the upload-to-review flow consistent wherever it
// is used and prevents a second, unnecessary "Extract" action from the user.
export function startExtractionForUploadedDocument(documents, startExtraction) {
  const document = documents?.[0];
  if (document) startExtraction(document);
}

export async function importReviewedRecipients(rows) {
  const selected = rows.filter((row) => row.selected !== false);
  if (!selected.length) throw new Error('Select at least one recipient to import.');
  if (selected.some((row) => !row.email?.trim())) {
    throw new Error('Each selected recipient needs an email address.');
  }
  if (selected.some((row) => !row.name?.trim())) {
    throw new Error('Each selected recipient needs a name. Add missing names before importing.');
  }
  if (selected.length > 1000) throw new Error('Select up to 1,000 contacts per import.');
  const recipients = selected.map(({ selected: checked, ...payload }) => payload);
  const { data } = await api.post('/recipients/import', { recipients });
  return data;
}

export const importSummary = ({ added, duplicates }) =>
  `${added} recipient${added === 1 ? '' : 's'} added${duplicates ? `; ${duplicates} already existed` : ''}.`;
