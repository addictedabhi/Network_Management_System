import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import CustomDashboardPage from '../src/app/dashboards/custom/page';
import { server, resetLayoutState } from './msw/server';
import { DASHBOARD_WIDGET_IDS } from '@nms/shared';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  resetLayoutState();
});
afterAll(() => server.close());

describe('Customisable dashboard page (ADR 0010)', () => {
  it('loads and renders the saved layout on mount', async () => {
    render(<CustomDashboardPage />);
    // The default layout carries FleetKpiTiles + AlarmFeed → their titles render as panel headers.
    expect(await screen.findByText('Fleet KPIs')).toBeInTheDocument();
    expect(screen.getByText('Active Alarms')).toBeInTheDocument();
  });

  it('the widget catalog shows ONLY real panels (the shared allowlist)', async () => {
    render(<CustomDashboardPage />);
    await screen.findByText('Fleet KPIs');
    await userEvent.click(screen.getByRole('button', { name: /arrange/i }));
    const menu = await screen.findByRole('region', { name: /add a widget/i });
    // Every real widget id has a catalog entry; nothing outside the allowlist appears.
    // (Titles are the human labels; there are exactly DASHBOARD_WIDGET_IDS.length add buttons.)
    const buttons = within(menu).getAllByRole('button');
    expect(buttons).toHaveLength(DASHBOARD_WIDGET_IDS.length);
  });

  it('adding a widget updates the layout AND persists via PUT', async () => {
    let putCalled = 0;
    server.use(
      http.put('/bff/api/v1/dashboard/layout', async ({ request }) => {
        putCalled += 1;
        const body = (await request.json()) as { widgets: unknown[] };
        return HttpResponse.json({ success: true, data: body });
      })
    );
    render(<CustomDashboardPage />);
    await screen.findByText('Fleet KPIs');
    await userEvent.click(screen.getByRole('button', { name: /arrange/i }));
    const menu = await screen.findByRole('region', { name: /add a widget/i });
    await userEvent.click(within(menu).getByRole('button', { name: /P2P Link Performance/i }));
    // The new panel appears in the grid (a heading, distinct from the catalog button), and the
    // change was persisted. The title also appears as the add-menu button, so query by heading.
    expect(await screen.findByRole('heading', { name: 'P2P Link Performance' })).toBeInTheDocument();
    await waitFor(() => expect(putCalled).toBeGreaterThan(0));
  });

  it('removing a widget updates the layout and persists via PUT', async () => {
    let lastPut: { widgets: { id: string }[] } | undefined;
    server.use(
      http.put('/bff/api/v1/dashboard/layout', async ({ request }) => {
        lastPut = (await request.json()) as typeof lastPut;
        return HttpResponse.json({ success: true, data: lastPut });
      })
    );
    render(<CustomDashboardPage />);
    await screen.findByText('Active Alarms');
    await userEvent.click(screen.getByRole('button', { name: /arrange/i }));
    // Remove the Active Alarms widget.
    await userEvent.click(screen.getByRole('button', { name: /remove active alarms/i }));
    await waitFor(() => expect(lastPut?.widgets.some((w) => w.id === 'AlarmFeed')).toBe(false));
  });

  it('reordering a widget persists the new order via PUT', async () => {
    let lastPut: { widgets: { id: string }[] } | undefined;
    server.use(
      http.put('/bff/api/v1/dashboard/layout', async ({ request }) => {
        lastPut = (await request.json()) as typeof lastPut;
        return HttpResponse.json({ success: true, data: lastPut });
      })
    );
    render(<CustomDashboardPage />);
    await screen.findByText('Fleet KPIs');
    await userEvent.click(screen.getByRole('button', { name: /arrange/i }));
    // Move Active Alarms (index 1) earlier → becomes index 0.
    await userEvent.click(screen.getByRole('button', { name: /move active alarms earlier/i }));
    await waitFor(() => expect(lastPut?.widgets[0]?.id).toBe('AlarmFeed'));
  });

  it('shows a save error (never a silent drop) when the PUT is rejected', async () => {
    server.use(
      http.put('/bff/api/v1/dashboard/layout', () =>
        HttpResponse.json(
          { success: false, errors: [{ code: 'VALIDATION_ERROR', message: 'bad' }], meta: { requestId: 'r' } },
          { status: 400 }
        )
      )
    );
    render(<CustomDashboardPage />);
    await screen.findByText('Fleet KPIs');
    await userEvent.click(screen.getByRole('button', { name: /arrange/i }));
    const menu = await screen.findByRole('region', { name: /add a widget/i });
    await userEvent.click(within(menu).getByRole('button', { name: /Top Interfaces/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/rejected by the server/i);
  });

  it('surfaces the honest withheld-RSSI "Not available" state inside the arrangeable P2P panel', async () => {
    render(<CustomDashboardPage />);
    await screen.findByText('Fleet KPIs');
    await userEvent.click(screen.getByRole('button', { name: /arrange/i }));
    const menu = await screen.findByRole('region', { name: /add a widget/i });
    await userEvent.click(within(menu).getByRole('button', { name: /P2P Link Performance/i }));
    // The withheld AF60 (device 4) renders "Not available", never a fabricated 0.
    expect(await screen.findAllByText(/not available/i)).not.toHaveLength(0);
  });
});
