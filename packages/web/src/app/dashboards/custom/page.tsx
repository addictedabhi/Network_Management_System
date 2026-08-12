'use client';

/**
 * Customisable ("My Dashboard") page (ADR 0010, Phase 3). A user adds / removes / reorders / resizes
 * widgets drawn from the REAL panel catalog; the layout persists PER USER via the BFF layout
 * endpoints (loaded on mount, saved on every change). No fabricated data — each panel keeps its own
 * loading / error / empty / unavailable states (FR-24/FR-43). Per-user scope is server-enforced from
 * the session subject (no user id ever leaves the browser).
 */
import { useMemo, useState } from 'react';
import { AuthedShell } from '../../../components/AuthedShell';
import { DataState } from '../../../components/DataState';
import { ArrangeableGrid } from '../../../components/dashboard/ArrangeableGrid';
import {
  WIDGET_CATALOG,
  WIDGET_META,
  renderWidget,
  type WidgetContext
} from '../../../components/dashboard/WidgetCatalog';
import { useDashboardLayout } from '../../../hooks/useDashboardLayout';
import { useBffQuery } from '../../../hooks/useBffQuery';
import { bffClient } from '../../../lib/bffClient';
import type { Device, Alarm, SessionInfo, DashboardWidget } from '@nms/shared';

const RANGE_MS = 86_400_000; // 24h window for the time-series panels.
const RANGE_STEP = '15m';

function saveErrorCopy(code: string | undefined): string {
  switch (code) {
    case 'VALIDATION_ERROR':
      return 'That change was rejected by the server and was not saved.';
    case 'UPSTREAM_UNAVAILABLE':
    case 'INTERNAL_ERROR':
      return 'The change could not be saved. Please try again.';
    default:
      return 'The change could not be saved.';
  }
}

function CustomDashboardView({ session }: { session: SessionInfo }) {
  const [editing, setEditing] = useState(false);
  const lay = useDashboardLayout();

  const range = useMemo(() => {
    const to = Date.now();
    return { from: new Date(to - RANGE_MS).toISOString(), to: new Date(to).toISOString(), step: RANGE_STEP };
  }, []);

  const devicesQ = useBffQuery<{ data: readonly Device[] }>(
    () => bffClient.listDevices('perPage=200'),
    (r) => r.data.length === 0
  );
  const alarmsQ = useBffQuery<{ data: readonly Alarm[] }>(
    () => bffClient.listAlarms('perPage=200'),
    () => false
  );

  const ctx: WidgetContext = {
    devices: devicesQ.data?.data ?? [],
    alarms: alarmsQ.data?.data ?? [],
    range,
    session
  };

  const widgets = lay.layout?.widgets ?? [];

  return (
    <>
      <div className="dash-head">
        <div>
          <h1>My Dashboard</h1>
          <p className="subtitle">
            A personal arrangement of AIRNMS panels. Your layout is saved to your account and
            restored on your next visit. Panels with no collected metric read “Not available” —
            never a fabricated zero.
          </p>
        </div>
        <div className="toolbar">
          {lay.saving ? <span className="chip" aria-live="polite">Saving…</span> : null}
          <button
            type="button"
            className={`btn${editing ? ' btn--primary' : ''}`}
            onClick={() => setEditing((e) => !e)}
            aria-pressed={editing}
          >
            {editing ? 'Done' : 'Arrange'}
          </button>
          {editing ? (
            <button type="button" className="btn btn--ghost" onClick={lay.reset}>
              Reset to default
            </button>
          ) : null}
        </div>
      </div>

      {lay.saveError ? (
        <div role="alert" className="data-state data-state--error">
          <p>{saveErrorCopy(lay.saveError)}</p>
        </div>
      ) : null}

      {editing ? (
        <AddWidgetMenu
          onAdd={lay.addWidget}
          disabled={widgets.length >= WIDGET_CATALOG.length * 4}
        />
      ) : null}

      <DataState status={lay.status} errorCode={lay.errorCode} onRetry={lay.reload}>
        {() => (
          <ArrangeableGrid
            widgets={widgets}
            editing={editing}
            saving={lay.saving}
            title={(w: DashboardWidget) => WIDGET_META[w.id].title}
            renderWidget={(w: DashboardWidget) => renderWidget(w.id, ctx, w.params)}
            onRemove={lay.removeWidget}
            onMove={lay.moveWidget}
            onResize={lay.resizeWidget}
          />
        )}
      </DataState>
    </>
  );
}

function AddWidgetMenu({
  onAdd,
  disabled
}: {
  onAdd: (id: (typeof WIDGET_CATALOG)[number]) => void;
  disabled: boolean;
}) {
  return (
    <section className="add-widget" aria-label="Add a widget">
      <h2 className="add-widget__title">Add a widget</h2>
      <ul className="add-widget__list">
        {WIDGET_CATALOG.map((id) => (
          <li key={id}>
            <button
              type="button"
              className="btn btn--ghost add-widget__item"
              onClick={() => onAdd(id)}
              disabled={disabled}
            >
              <span className="add-widget__name">{WIDGET_META[id].title}</span>
              <span className="add-widget__blurb">{WIDGET_META[id].blurb}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function CustomDashboardPage() {
  return <AuthedShell>{(session) => <CustomDashboardView session={session} />}</AuthedShell>;
}
