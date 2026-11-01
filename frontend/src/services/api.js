import axios from 'axios';
export const api = axios.create({ baseURL: '/api/v1', timeout: 120000 });
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
  if (session.access()) config.headers.Authorization = `Bearer ${session.access()}`;
  return config;
});
let refreshPromise;
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error.config;
    if (error.response?.status === 401 && !config._retry && !config.url.startsWith('/auth/')) {
      config._retry = true;
      try {
        refreshPromise ||= axios
          .post('/api/v1/auth/refresh', { refresh_token: session.refresh() })
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
  const detail = error.response?.data?.detail;
  return typeof detail === 'string'
    ? detail
    : Array.isArray(detail)
      ? detail.map((i) => `${i.loc.at(-1)}: ${i.msg}`).join('; ')
      : error.message || 'Request failed';
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
