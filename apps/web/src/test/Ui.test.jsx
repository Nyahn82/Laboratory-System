import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EmptyState, StatusBadge } from '../components/Ui.jsx';

describe('shared UI states', () => {
  it('presents workflow statuses in readable form', () => {
    render(<StatusBadge status="FOR_VERIFICATION" />);
    expect(screen.getByText('FOR VERIFICATION')).toBeInTheDocument();
  });

  it('renders an explicit empty state', () => {
    render(<EmptyState title="Queue is clear" message="Nothing is waiting." />);
    expect(screen.getByRole('heading', { name: 'Queue is clear' })).toBeInTheDocument();
    expect(screen.getByText('Nothing is waiting.')).toBeInTheDocument();
  });
});

