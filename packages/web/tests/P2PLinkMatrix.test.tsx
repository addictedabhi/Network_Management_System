import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { P2PLinkMatrix } from '../src/components/dashboard/P2PLinkMatrix';
import { available, type Device } from '@nms/shared';
import { server } from './msw/server';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const radios: Device[] = [
  { id: '3', hostname: 'sim-af60', displayName: 'AF60 radio', kind: 'p2p', location: 'roof', reachability: 'up', uptimeSeconds: available(1) },
  { id: '4', hostname: 'sim-af60-withheld', displayName: 'AF60 (RSSI withheld)', kind: 'p2p', location: 'roof', reachability: 'up', uptimeSeconds: available(1) }
];

describe('P2PLinkMatrix (FR-20/21/24 showcase)', () => {
  it('renders one row per radio link with real SNR', async () => {
    render(<P2PLinkMatrix radios={radios} />);
    expect(await screen.findByText('AF60 radio')).toBeInTheDocument();
    expect(screen.getByText('AF60 (RSSI withheld)')).toBeInTheDocument();
    // SNR available (31 dB from the mock) shows a real number.
    expect(await screen.findAllByText(/31/)).not.toHaveLength(0);
  });

  it('renders the withheld radio RSSI as "Not available", never 0 (FR-24)', async () => {
    render(<P2PLinkMatrix radios={radios} />);
    const withheldRow = (await screen.findByText('AF60 (RSSI withheld)')).closest('tr')!;
    expect(within(withheldRow).getByText(/not available/i)).toBeInTheDocument();
    // No fabricated 0 in the withheld row's RSSI cell.
    expect(within(withheldRow).queryByText('0')).not.toBeInTheDocument();
  });

  it('shows an honest empty state when there are no radios', () => {
    render(<P2PLinkMatrix radios={[]} />);
    expect(screen.getByText(/no point-to-point radio links/i)).toBeInTheDocument();
  });
});
