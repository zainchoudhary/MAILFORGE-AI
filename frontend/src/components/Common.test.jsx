import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { Status, Pagination, QueryState } from './Common';
import { EmailPreview } from './RichEditor';
describe('Delivery semantics and safe UI', () => {
  it('labels SMTP acceptance without claiming delivery', () => {
    render(<Status value="smtp_accepted" />);
    expect(screen.getByText('smtp accepted')).toBeInTheDocument();
    expect(screen.queryByText('delivered')).not.toBeInTheDocument();
  });
  it('sandboxes untrusted email HTML', () => {
    render(<EmailPreview subject="Hello" body="<script>alert(1)</script>" />);
    const frame = screen.getByTitle('Email preview');
    expect(frame).toHaveAttribute('sandbox', '');
    expect(frame.getAttribute('srcdoc')).toContain("default-src 'none'");
  });
  it('paginates without advancing beyond available results', () => {
    const setPage = vi.fn();
    render(<Pagination data={{ total: 30, limit: 25 }} page={1} setPage={setPage} />);
    expect(screen.getByText('Previous')).toBeDisabled();
    fireEvent.click(screen.getByText('Next'));
    expect(setPage).toHaveBeenCalledWith(2);
  });
  it('shows API failures and provides an actual retry action', () => {
    const refetch = vi.fn();
    render(<QueryState query={{ isError: true, error: new Error('offline'), refetch }} />);
    expect(screen.getByText('offline')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Try again'));
    expect(refetch).toHaveBeenCalled();
  });
});
