import axios from 'axios';
const baseURL = import.meta.env.VITE_API_BASE_URL || '/api/v1';
export const api = axios.create({
  baseURL,
  timeout: Number(import.meta.env.VITE_API_TIMEOUT || 120000),
  headers: { Accept: 'application/json' },
});
// Persistent browser session; tokens never enter URLs. Production should enforce HTTPS and CSP.
export const session = {
  access: () => localStorage.getItem('mf_access') || sessionStorage.getItem('mf_access'),
  refresh: () => localStorage.getItem('mf_refresh') || sessionStorage.getItem('mf_refresh'),
  save: (data) => {
    localStorage.setItem('mf_access', data.access_token);
    localStorage.setItem('mf_refresh', data.refresh_token);
    sessionStorage.removeItem('mf_access');
    sessionStorage.removeItem('mf_refresh');
  },
  clear: () => {
    localStorage.removeItem('mf_access');
    localStorage.removeItem('mf_refresh');
    sessionStorage.removeItem('mf_access');
    sessionStorage.removeItem('mf_refresh');
  },
};
// An unexpired access token is sufficient after a normal reload. Its signature
// is verified by the API on each request; this local check only avoids needless
// refresh-token calls while the access token is still valid.
export const accessIsUsable = () => {
  const token = session.access();
  if (!token) return false;
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return Number(payload.exp) * 1000 > Date.now() + 30_000;
  } catch {
    return false;
  }
};
api.interceptors.request.use((config) => {
  config.headers = config.headers || {};
  if (session.access()) config.headers.Authorization = `Bearer ${session.access()}`;
  return config;
});
let refreshPromise;
const refreshAccess = () => {
  if (!session.refresh()) return Promise.reject(new Error('No saved session'));
  refreshPromise ||= axios
    .post(`${baseURL}/auth/refresh`, { refresh_token: session.refresh() }, { timeout: 15000 })
    .then((response) => {
      session.save(response.data);
      return response.data;
    })
    .finally(() => {
      refreshPromise = null;
    });
  return refreshPromise;
};
export const restoreSession = async () => {
  if (accessIsUsable()) return true;
  try {
    await refreshAccess();
    return true;
  } catch (error) {
    // A temporary API/network failure must never erase a persistent browser
    // session. Only the server can tell us that the saved credential is invalid.
    if ([401, 403].includes(error.response?.status)) {
      session.clear();
      return false;
    }
    return !!session.access() || !!session.refresh();
  }
};
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error.config;
    if (error.response?.status === 401 && config && !config._retry && !config.url?.includes('/auth/')) {
      config._retry = true;
      try {
        await refreshAccess();
        return api(config);
      } catch (refreshError) {
        if ([401, 403].includes(refreshError.response?.status)) {
          session.clear();
          window.location.assign('/login');
        }
        return Promise.reject(error);
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
