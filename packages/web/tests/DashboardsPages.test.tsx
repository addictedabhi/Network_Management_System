import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { server } from './msw/server';

// Mock EChart so canvas-based panels render a stable testid in jsdom.
vi.mock('../src/components/EChart', () => ({
  EChart: (props: { ariaLabel: string }) => <div data-testid="echart" aria-label={props.ariaLabel} />
}));

import CapacityPage from '../src/app/dashboards/capacity/page';
import TopTalkersPage from '../src/app/dashboards/top-talkers/page';
import FleetTrendsPage from '../src/app/dashboards/fleet-trends/page';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('Phase 3 d — the 3 fixed dashboards', () => {
  it('Capacity dashboard renders and states the honest N/A caveat', async () => {
    render(<CapacityPage />);
    expect(await screen.findByRole('heading', { name: 'Capacity', level: 1 })).toBeInTheDocument();
    // The honest N/A note (radio memory + ping host) is present.
    expect(screen.getByText(/never a fabricated zero/i)).toBeInTheDocument();
  });

  it('Top-talkers dashboard renders the 95th-percentile interfaces panel', async () => {
    render(<TopTalkersPage />);
    expect(await screen.findByRole('heading', { name: 'Top talkers', level: 1 })).toBeInTheDocument();
    expect(await screen.findByText(/top interfaces \(95th percentile\)/i)).toBeInTheDocument();
  });

  it('Fleet-trends dashboard shows a real active-alarm total (2 real alarms), never padded', async () => {
    render(<FleetTrendsPage />);
    expect(await screen.findByRole('heading', { name: 'Fleet trends', level: 1 })).toBeInTheDocument();
    // The 2 real alarms from MSW appear as the active total.
    expect(await screen.findByText('2')).toBeInTheDocument();
    expect(screen.getByText(/sparse-but-real/i)).toBeInTheDocument();
  });
});
