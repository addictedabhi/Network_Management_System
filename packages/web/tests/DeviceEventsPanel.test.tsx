import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DeviceEventsPanel } from '../src/components/device/DeviceEventsPanel';
import { server } from './msw/server';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('DeviceEventsPanel (Phase 3 c, N2)', () => {
  it('shows real eventlog rows by default', async () => {
    render(<DeviceEventsPanel id="1" />);
    expect(await screen.findByText('Device polled')).toBeInTheDocument();
    expect(screen.getByText('poller')).toBeInTheDocument();
  });

  it('shows the honest EMPTY syslog state at POC (not an error) when switched to syslog', async () => {
    render(<DeviceEventsPanel id="1" />);
    await screen.findByText('Device polled');
    await userEvent.click(screen.getByRole('button', { name: /syslog/i }));
    expect(await screen.findByText(/no syslog messages received/i)).toBeInTheDocument();
  });
});
