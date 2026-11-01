import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, errorText } from '../services/api';
export const useApi = (url, options = {}) =>
  useQuery({ queryKey: [url], queryFn: async () => (await api.get(url)).data, ...options });
export function useAction(fn, message = 'Saved successfully') {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      // Let active screens receive the committed server state before showing
      // completion feedback. This prevents a toast from appearing early while
      // the UI still shows the old status.
      await client.invalidateQueries();
      if (message) toast.success(message, { duration: 3000 });
    },
    onError: (e) => toast.error(errorText(e)),
  });
}
