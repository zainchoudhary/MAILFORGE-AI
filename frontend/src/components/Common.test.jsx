import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { Status, Pagination, QueryState, BusyButton, ConfirmDialog, PickerDropdown } from './Common';
import { EmailPreview } from './RichEditor';
describe('Delivery semantics and safe UI', () => {
  it('keeps pending buttons disabled even when disabled=false is passed', () => {
    render(<BusyButton busy disabled={false}>Submit pending</BusyButton>);
    expect(screen.getByText('Submit pending')).toBeDisabled();
  });
  it('keeps confirmation open through a failure and allows a successful retry', async () => {
    let rejectRequest;
    const onConfirm = vi.fn().mockImplementationOnce(() => new Promise((resolve, reject) => { rejectRequest = reject; })).mockResolvedValueOnce({});
    const close = vi.fn();
    render(<ConfirmDialog open onOpenChange={close} onConfirm={onConfirm} itemLabel="Synthetic contact" />);
    fireEvent.click(screen.getByText('Delete permanently'));
    expect(screen.getByLabelText('Close')).toBeDisabled();
    expect(screen.getByText('Keep it')).toBeDisabled();
    expect(close).not.toHaveBeenCalled();
    await act(async () => rejectRequest(new Error('Server unavailable')));
    expect(screen.getByRole('alert')).toHaveTextContent('Server unavailable');
    expect(close).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Delete permanently'));
    await waitFor(() => expect(close).toHaveBeenCalledWith(false));
  });
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
    expect(screen.getByText('Showing 1–25 of 30')).toBeInTheDocument();
    expect(screen.getByText('Page 1 of 2 · 25 per page')).toBeInTheDocument();
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
  it('filters searchable picker options and selects a filtered result', () => {
    const onChange = vi.fn();
    render(<PickerDropdown searchable value="" onChange={onChange} placeholder="Choose contact" options={[
      { value: 'ayesha', label: 'Ayesha Khan', description: 'Northstar Labs' },
      { value: 'omar', label: 'Omar Siddiqui', description: 'Vertex Systems' },
    ]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Choose contact' }));
    fireEvent.change(screen.getByPlaceholderText('Search options'), { target: { value: 'vertex' } });
    expect(screen.getByText('Omar Siddiqui')).toBeInTheDocument();
    expect(screen.queryByText('Ayesha Khan')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Omar Siddiqui'));
    expect(onChange).toHaveBeenCalledWith('omar');
  });
  it('explains when a searchable picker has no matching options', () => {
    render(<PickerDropdown searchable value="" onChange={vi.fn()} placeholder="Choose contact" options={[{ value: 'ayesha', label: 'Ayesha Khan' }]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Choose contact' }));
    fireEvent.change(screen.getByPlaceholderText('Search options'), { target: { value: 'missing' } });
    expect(screen.getByText('No matching options')).toBeInTheDocument();
  });
});
