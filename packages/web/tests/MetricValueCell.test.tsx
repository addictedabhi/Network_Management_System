import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MetricValueCell } from '../src/components/MetricValueCell';
import { available, unavailable } from '@nms/shared';

describe('MetricValueCell (FR-24)', () => {
  it('renders an available value with its unit', () => {
    render(<MetricValueCell metric={available(42, '2026-08-10T00:00:00Z')} unit="s" />);
    expect(screen.getByText(/42/)).toBeInTheDocument();
    expect(screen.getByText(/s/)).toBeInTheDocument();
  });

  it('renders "Not available" for an unavailable metric — never 0, never healthy', () => {
    render(<MetricValueCell metric={unavailable('OID_NOT_SUPPORTED')} unit="dBm" />);
    expect(screen.getByText(/not available/i)).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('conveys unavailability by text (title), not colour alone (NFR-30)', () => {
    render(<MetricValueCell metric={unavailable('NO_DATA')} unit="s" />);
    expect(screen.getByTitle(/not available/i)).toBeInTheDocument();
  });

  it('does NOT render a fabricated zero for an unavailable value', () => {
    const { container } = render(<MetricValueCell metric={unavailable('UPSTREAM_UNAVAILABLE')} />);
    expect(container.textContent).not.toContain('0');
    expect(container.textContent).toMatch(/not available/i);
  });
});
