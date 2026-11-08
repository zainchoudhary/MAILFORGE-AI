import React from 'react';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';

vi.mock('../services/api', () => ({
  api: { get: vi.fn(async (url) => ({ data: url === '/campaigns/campaign-1' ? { id: 'campaign-1', name: 'Partial campaign', subject: 'Hello', description: '', status: 'processing', recipients: [], counts: {}, attachments: [], cc: [], bcc: [], revision: 1 } : url.startsWith('/campaigns') ? { items: [], total: 0, limit: 25 } : { items: [], total: 0, limit: 25 } })), delete: vi.fn(), post: vi.fn() },
  downloadFile: vi.fn(),
  errorText: vi.fn(() => 'Request failed'),
}));

import Campaigns, { CampaignDetail } from './Campaigns';
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
  it('does not crash when a compact campaign response is briefly cached during navigation', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['/campaigns/campaign-1'], {
      id: 'campaign-1', name: 'Partial campaign', status: 'processing', subject: 'Hello',
    });
    render(<MemoryRouter initialEntries={['/campaigns/campaign-1']}><QueryClientProvider client={client}><Routes><Route path="/campaigns/:id" element={<CampaignDetail />} /></Routes></QueryClientProvider></MemoryRouter>);
    expect(await screen.findByText('Partial campaign')).toBeInTheDocument();
  });
});

describe('LinkedIn search route', () => {
  it('shows capture instructions when there are no runs', async () => {
    const { default: LinkedInFinder } = await import('./LinkedInFinder');
    renderRoute(<LinkedInFinder />);
    expect(await screen.findByText('Capture your first LinkedIn Jobs search')).toBeInTheDocument();
    expect(await screen.findByText('No captures yet.')).toBeInTheDocument();
  });
});
