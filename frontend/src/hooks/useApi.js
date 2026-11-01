import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, errorText } from '../services/api';
import { useRef } from 'react';
export const useApi = (url, options = {}) =>
  useQuery({ queryKey: [url], queryFn: async ({ signal }) => (await api.get(url, { signal })).data, ...options });
export function useAction(fn, message = 'Saved successfully', options = {}) {
  const client = useQueryClient();
  const inFlight = useRef(null);
  const mutation = useMutation({
    mutationFn: fn,
    ...options,
    onSuccess: async (data, variables, context) => {
      // Let active screens receive the committed server state before showing
      // completion feedback. This prevents a toast from appearing early while
      // the UI still shows the old status.
      if (options.invalidatePrefixes?.length) {
        await client.invalidateQueries({
          predicate: (query) =>
            options.invalidatePrefixes.some(
              (prefix) => typeof query.queryKey[0] === 'string' && query.queryKey[0].startsWith(prefix),
            ),
          refetchType: 'active',
        });
      } else if (options.invalidateKeys?.length) {
        await Promise.all(
          options.invalidateKeys.map((queryKey) =>
            client.invalidateQueries({ queryKey: [queryKey], refetchType: 'active' }),
          ),
        );
      } else {
        await client.invalidateQueries({ refetchType: 'active' });
      }
      // Let React paint the refreshed state before showing completion feedback.
      // This keeps the toast from appearing ahead of the updated table.
      await new Promise((resolve) => requestAnimationFrame(resolve));
      await options.onSuccess?.(data, variables, context);
      if (message) toast.success(typeof message === 'function' ? message(data) : message, { duration: 3000 });
    },
    onError: (e, variables, context) => {
      toast.error(errorText(e));
      options.onError?.(e, variables, context);
    },
  });
  // React state updates on the next render; a ref also blocks same-tick double clicks.
  const mutateAsync = (variables, callbacks) => {
    if (inFlight.current) return inFlight.current;
    inFlight.current = mutation.mutateAsync(variables, callbacks).finally(() => {
      inFlight.current = null;
    });
    return inFlight.current;
  };
  return { ...mutation, mutateAsync, mutate: (variables, callbacks) => {
    void mutateAsync(variables, callbacks).catch(() => {});
  } };
}
