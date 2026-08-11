import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DataState } from '../src/components/DataState';

describe('DataState (FR-43)', () => {
  it('renders a loading state', () => {
    render(<DataState status="loading">{() => <div>content</div>}</DataState>);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders an explicit error with a retry action, never a blank view', () => {
    render(
      <DataState status="error" errorCode="UPSTREAM_UNAVAILABLE" onRetry={vi.fn()}>
        {() => <div />}
      </DataState>
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/unavailable/i);
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('renders an empty state distinct from the error state', () => {
    render(
      <DataState status="empty" emptyLabel="devices">
        {() => <div />}
      </DataState>
    );
    expect(screen.getByText(/no devices found/i)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders content when loaded', () => {
    render(<DataState status="success">{() => <div>content</div>}</DataState>);
    expect(screen.getByText('content')).toBeInTheDocument();
  });
});
