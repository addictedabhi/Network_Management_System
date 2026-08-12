import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { server } from './msw/server';

// Mock EChart so trend panels render a stable testid (canvas is not meaningful in jsdom).
vi.mock('../src/components/EChart', () => ({
  EChart: (props: { ariaLabel: string }) => <div data-testid="echart" aria-label={props.ariaLabel} />
}));

import LinksPage from '../src/app/links/page';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('P2P link matrix page (Phase 3 b)', () => {
  it('renders a trend section per radio link', async () => {
    render(<LinksPage />);
    expect(await screen.findByRole('heading', { name: /^AF60 radio/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /AF60 \(RSSI withheld\)/ })).toBeInTheDocument();
  });

  it('plots real RF trend charts (SNR present) and shows the withheld RSSI as an honest empty trend, never a 0 line', async () => {
    render(<LinksPage />);
    // The withheld radio's section header.
    const heading = await screen.findByRole('heading', { name: /AF60 \(RSSI withheld\)/i });
    const section = heading.closest('section')!;
    // Its RSSI trend panel shows the honest EMPTY state — no fabricated 0 chart (async resolve).
    expect(await within(section).findByText(/no rssi data points in this window/i)).toBeInTheDocument();
    // At least one real trend chart (SNR/Tx/Rx/Frequency) is plotted for that radio.
    expect(within(section).getAllByTestId('echart').length).toBeGreaterThan(0);
  });
});
