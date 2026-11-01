import axios from 'axios';
const baseURL = import.meta.env.VITE_API_BASE_URL || '/api/v1';
export const api = axios.create({
  baseURL,
  timeout: Number(import.meta.env.VITE_API_TIMEOUT || 120000),
  headers: { Accept: 'application/json' },
});
// Tab-scoped persistence; tokens never enter URLs. Production should enforce HTTPS and CSP.
export const session = {
  access: () => sessionStorage.getItem('mf_access'),
  refresh: () => sessionStorage.getItem('mf_refresh'),
  save: (data) => {
    sessionStorage.setItem('mf_access', data.access_token);
    sessionStorage.setItem('mf_refresh', data.refresh_token);
  },
  clear: () => {
    sessionStorage.removeItem('mf_access');
    sessionStorage.removeItem('mf_refresh');
  },
};
api.interceptors.request.use((config) => {
  config.headers = config.headers || {};
  if (session.access()) config.headers.Authorization = `Bearer ${session.access()}`;
  return config;
});
let refreshPromise;
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error.config;
    if (error.response?.status === 401 && config && !config._retry && !config.url?.includes('/auth/')) {
      config._retry = true;
      try {
        refreshPromise ||= axios
          .post(`${baseURL}/auth/refresh`, { refresh_token: session.refresh() }, { timeout: 15000 })
          .then((r) => {
            session.save(r.data);
          })
          .finally(() => {
            refreshPromise = null;
          });
        await refreshPromise;
        return api(config);
      } catch {
        session.clear();
        window.location.assign('/login');
      }
    }
    return Promise.reject(error);
  },
);
export const errorText = (error) => {
  if (!error?.response) {
    if (!axios.isAxiosError(error)) return error?.message || 'Action failed. Please try again.';
    if (error?.code === 'ECONNABORTED' || error?.code === 'ETIMEDOUT') return 'The request timed out. Please try again.';
    if (error?.code === 'ERR_CANCELED') return 'Request cancelled.';
    return 'Unable to reach the server. Check your connection and try again.';
  }
  const detail = error.response?.data?.detail;
  return typeof detail === 'string'
    ? detail
    : Array.isArray(detail)
      ? detail.map((i) => `${i.loc.at(-1)}: ${i.msg}`).join('; ')
      : ({
          400: 'The request could not be completed.',
          401: 'Your session has expired. Please sign in again.',
          403: 'You do not have permission to perform this action.',
          404: 'The requested record was not found.',
          409: 'This action conflicts with the current data.',
          422: 'Please check the highlighted fields and try again.',
          429: 'Too many requests. Please wait a moment and try again.',
          500: 'Something went wrong on the server.',
          502: 'The service is temporarily unavailable.',
          503: 'The service is temporarily unavailable.',
          504: 'The service took too long to respond.',
        }[error.response.status] || 'Request failed');
};
export async function downloadFile(url, filename) {
  const { data } = await api.get(url, { responseType: 'blob' });
  const href = URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}
