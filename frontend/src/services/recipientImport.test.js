import { describe, it, expect, vi, beforeEach } from 'vitest';
import { api } from './api';
import { reviewRows, importReviewedRecipients, importSummary } from './recipientImport';
vi.mock('./api', () => ({ api: { post: vi.fn() } }));
beforeEach(() => vi.resetAllMocks());
describe('Reviewed recipient imports', () => {
  it('imports untouched worker results instead of an empty edit buffer', async () => {
    api.post.mockResolvedValue({ data: { id: 'saved' } });
    const rows = reviewRows(null, { records: [{ email: 'alex@example.com' }] });
    expect(await importReviewedRecipients(rows)).toEqual({ added: 1, duplicates: 0 });
    expect(api.post).toHaveBeenCalledWith('/recipients', { email: 'alex@example.com' });
  });
  it('preserves intentional empty edits and rejects an empty import', async () => {
    const rows = reviewRows([], { records: [{ email: 'alex@example.com' }] });
    await expect(importReviewedRecipients(rows)).rejects.toThrow('Select at least');
    expect(api.post).not.toHaveBeenCalled();
  });
  it('respects manual deselection and reports duplicates accurately', async () => {
    api.post.mockRejectedValue({ response: { status: 409 } });
    const result = await importReviewedRecipients([
      { email: 'skip@example.com', selected: false }, { email: 'exists@example.com' },
    ]);
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(importSummary(result)).toBe('0 recipients added; 1 already existed.');
  });
  it('does not report success after a partial failure', async () => {
    api.post.mockResolvedValueOnce({}).mockRejectedValueOnce({ response: { status: 503 } });
    await expect(importReviewedRecipients([{ email: 'a@example.com' }, { email: 'b@example.com' }]))
      .rejects.toThrow('1 saved before import stopped');
  });
});
