import { describe, it, expect, vi, beforeEach } from 'vitest';
import { api } from './api';
import { reviewRows, importReviewedRecipients, importSummary } from './recipientImport';
vi.mock('./api', () => ({ api: { post: vi.fn() } }));
beforeEach(() => vi.resetAllMocks());
describe('Reviewed recipient imports', () => {
  it('imports untouched worker results instead of an empty edit buffer', async () => {
    api.post.mockResolvedValue({ data: { added: 1, duplicates: 0 } });
    const rows = reviewRows(null, { records: [{ email: 'alex@example.com' }] });
    expect(await importReviewedRecipients(rows)).toEqual({ added: 1, duplicates: 0 });
    expect(api.post).toHaveBeenCalledWith('/recipients/import', { recipients: [{ email: 'alex@example.com' }] });
  });
  it('preserves intentional empty edits and rejects an empty import', async () => {
    const rows = reviewRows([], { records: [{ email: 'alex@example.com' }] });
    await expect(importReviewedRecipients(rows)).rejects.toThrow('Select at least');
    expect(api.post).not.toHaveBeenCalled();
  });
  it('respects manual deselection and reports duplicates accurately', async () => {
    api.post.mockResolvedValue({ data: { added: 0, duplicates: 1 } });
    const result = await importReviewedRecipients([
      { email: 'skip@example.com', selected: false }, { email: 'exists@example.com' },
    ]);
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(importSummary(result)).toBe('0 recipients added; 1 already existed.');
  });
  it('propagates a failed batch without reporting success', async () => {
    api.post.mockRejectedValue(new Error('Service unavailable'));
    await expect(importReviewedRecipients([{ email: 'a@example.com' }, { email: 'b@example.com' }]))
      .rejects.toThrow('Service unavailable');
  });
  it('sends 77 contacts in exactly one request', async () => {
    api.post.mockResolvedValue({ data: { added: 77, duplicates: 0 } });
    const rows = Array.from({ length: 77 }, (_, i) => ({ email: `contact${i}@example.com` }));
    expect(await importReviewedRecipients(rows)).toEqual({ added: 77, duplicates: 0 });
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith('/recipients/import', { recipients: rows });
  });
});
