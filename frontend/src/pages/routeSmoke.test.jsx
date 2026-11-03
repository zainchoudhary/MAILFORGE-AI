import React from 'react';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';

vi.mock('../services/api', () => ({
  api: { get: vi.fn(async (url) => ({ data: url.startsWith('/campaigns') ? { items: [], total: 0, limit: 25 } : { items: [], total: 0, limit: 25 } })), delete: vi.fn(), post: vi.fn() },
  downloadFile: vi.fn(),
  errorText: vi.fn(() => 'Request failed'),
}));

import Campaigns from './Campaigns';
import Documents from './Documents';

function renderRoute(ui) {
  return render(<MemoryRouter><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider></MemoryRouter>);
}

describe('campaign and attachment routes', () => {
  it('renders the campaign listing after reload-shaped data resolves', async () => {
    renderRoute(<Campaigns />);
    expect(await screen.findByText('No campaigns found')).toBeInTheDocument();
  });
  it('renders the attachment library after reload-shaped data resolves', async () => {
    renderRoute(<Documents />);
    expect(await screen.findByText('Upload your first attachment')).toBeInTheDocument();
  });
});
