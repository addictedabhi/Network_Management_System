import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AlarmHistoryTimeline } from '../src/components/alarms/AlarmHistoryTimeline';
import { server } from './msw/server';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('AlarmHistoryTimeline (N1)', () => {
  it('renders the real state-transition timeline with labels (icon+text, not colour alone)', async () => {
    render(<AlarmHistoryTimeline alarmId="1" />);
    expect(await screen.findByText('Raised')).toBeInTheDocument();
    expect(screen.getByText('Recovered')).toBeInTheDocument();
    expect(screen.getByText('ICMP unreachable')).toBeInTheDocument();
  });

  it('shows an honest EMPTY state (not error) when there are no transitions', async () => {
    render(<AlarmHistoryTimeline alarmId="2" />);
    expect(await screen.findByText(/no recorded state transitions/i)).toBeInTheDocument();
  });
});
