import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { AuthProvider } from './context/AuthContext';
import App from './App';
import './styles/index.css';
const client = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) =>
        !error.response || [408, 429, 500, 502, 503, 504].includes(error.response.status)
          ? failureCount < 2
          : false,
      staleTime: 15000,
      gcTime: 10 * 60 * 1000,
      refetchOnWindowFocus: 'always',
      refetchOnReconnect: true,
    },
    mutations: { retry: false },
  },
});
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QueryClientProvider client={client}>
      <AuthProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
        <Toaster
          theme="light"
          richColors
          closeButton
          position="bottom-right"
          toastOptions={{
            duration: 3200,
            classNames: {
              toast: 'mf-toast',
              title: 'mf-toast-title',
              description: 'mf-toast-description',
              success: 'mf-toast-success',
              error: 'mf-toast-error',
              warning: 'mf-toast-warning',
            },
          }}
        />
      </AuthProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
