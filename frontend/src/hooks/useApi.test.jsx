import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi } from 'vitest';
import { toast } from 'sonner';
import { useAction } from './useApi';
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
describe('Shared action lifecycle', () => {
  it('deduplicates clicks and waits for synchronization before closing and notifying', async () => {
    let completeRequest, completeRefresh;
    const request = vi.fn(() => new Promise((resolve) => { completeRequest = resolve; }));
    const client = new QueryClient();
    vi.spyOn(client, 'invalidateQueries').mockImplementation(() => new Promise((resolve) => { completeRefresh = resolve; }));
    const close = vi.fn();
    const wrapper = ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useAction(request, 'Saved', { onSuccess: close }), { wrapper });
    act(() => { result.current.mutate(); result.current.mutate(); });
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    act(() => completeRequest({ id: 'confirmed' }));
    await waitFor(() => expect(client.invalidateQueries).toHaveBeenCalled());
    expect(close).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    act(() => completeRefresh());
    await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
    expect(toast.success).toHaveBeenCalledWith('Saved', { duration: 3000 });
  });
});
