import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it } from 'vitest';
import { RecipientImportTemplateButton } from './RecipientImportTemplateButton';

describe('RecipientImportTemplateButton', () => {
  it('downloads the official recipient Excel template', () => {
    render(<RecipientImportTemplateButton />);

    const link = screen.getByRole('link', { name: /download excel template/i });
    expect(link).toHaveAttribute('href', '/recipient-import-template.xlsx');
    expect(link).toHaveAttribute('download', 'recipient-import-template.xlsx');
  });
});
