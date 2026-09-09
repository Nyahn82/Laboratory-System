import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PublicVerificationPage } from '../pages/PublicVerificationPage.jsx';

afterEach(() => vi.restoreAllMocks());

describe('public verification', () => {
  it('shows only redacted proof fields', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      success: true,
      message: 'Verified',
      data: { opaqueRecordId: 'record-opaque', status: 'VALID', version: 2, issuingOrganization: 'RHU Laboratory', releasedAt: '2026-08-28T01:00:00.000Z' },
      errors: [],
    }), { status: 200, headers: { 'content-type': 'application/json' } })));
    render(<MemoryRouter initialEntries={['/verify/token']}><Routes><Route path="/verify/:token" element={<PublicVerificationPage />} /></Routes></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: /laboratory record verified/i })).toBeInTheDocument();
    expect(screen.getByText('record-opaque')).toBeInTheDocument();
    expect(screen.queryByText(/patient name/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/result value/i)).not.toBeInTheDocument();
  });
});
