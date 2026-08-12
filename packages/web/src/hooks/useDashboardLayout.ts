'use client';

/**
 * Client state for the customisable dashboard (ADR 0010). Loads the caller's layout on mount (GET),
 * and persists every add/remove/reorder/resize back to the BFF (PUT). Per-user scope is enforced
 * SERVER-SIDE from the session subject — this hook never sends a user id.
 *
 * The four data-states of the LOAD are surfaced via `status`; a save failure is surfaced via
 * `saveError` so the page can tell the user the change did not persist (never a silent drop).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { bffClient, BffError } from '../lib/bffClient';
import type { DataStatus } from '../components/DataState';
import type { DashboardLayout, DashboardWidget, DashboardWidgetId } from '@nms/shared';
import { DASHBOARD_GRID } from '@nms/shared';

export interface UseDashboardLayout {
  readonly status: DataStatus;
  readonly errorCode: string | undefined;
  readonly layout: DashboardLayout | undefined;
  readonly saving: boolean;
  readonly saveError: string | undefined;
  readonly reload: () => void;
  readonly addWidget: (id: DashboardWidgetId) => void;
  readonly removeWidget: (index: number) => void;
  readonly moveWidget: (index: number, delta: -1 | 1) => void;
  readonly resizeWidget: (index: number, patch: Partial<Pick<DashboardWidget, 'w' | 'h'>>) => void;
  readonly reset: () => void;
}

/** Place a newly-added widget full-width at the bottom of the current stack. */
function nextPlacement(widgets: readonly DashboardWidget[]): { x: number; y: number } {
  const maxY = widgets.reduce((m, w) => Math.max(m, w.y + w.h), 0);
  return { x: 0, y: maxY };
}

export function useDashboardLayout(): UseDashboardLayout {
  const [status, setStatus] = useState<DataStatus>('loading');
  const [errorCode, setErrorCode] = useState<string | undefined>(undefined);
  const [layout, setLayout] = useState<DashboardLayout | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>(undefined);
  const [nonce, setNonce] = useState(0);
  // Serialises saves so a rapid sequence of edits persists in order (last write wins on the server).
  const saveChain = useRef<Promise<unknown>>(Promise.resolve());

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setErrorCode(undefined);
    bffClient
      .getDashboardLayout()
      .then((data) => {
        if (cancelled) return;
        setLayout(data);
        setStatus('success');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setErrorCode(err instanceof BffError ? err.code : 'INTERNAL_ERROR');
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  /** Persist a new layout, keeping the optimistic UI but reverting on a save failure. */
  const persist = useCallback((next: DashboardLayout, previous: DashboardLayout) => {
    setLayout(next);
    setSaving(true);
    setSaveError(undefined);
    saveChain.current = saveChain.current
      .then(() => bffClient.putDashboardLayout(next))
      .then((saved) => {
        setLayout(saved);
        setSaving(false);
      })
      .catch((err: unknown) => {
        // The write did not persist — revert the optimistic change and tell the user (no silent
        // drop). The server rejected the layout (e.g. validation) or was unavailable.
        setLayout(previous);
        setSaveError(err instanceof BffError ? err.code : 'INTERNAL_ERROR');
        setSaving(false);
      });
  }, []);

  const mutate = useCallback(
    (fn: (widgets: DashboardWidget[]) => DashboardWidget[]) => {
      setLayout((current) => {
        if (!current) return current;
        const next: DashboardLayout = { version: 'v1', widgets: fn([...current.widgets]) };
        persist(next, current);
        return next;
      });
    },
    [persist]
  );

  const addWidget = useCallback(
    (id: DashboardWidgetId) => {
      mutate((widgets) => {
        if (widgets.length >= DASHBOARD_GRID.maxWidgets) return widgets;
        const { x, y } = nextPlacement(widgets);
        widgets.push({ id, x, y, w: DASHBOARD_GRID.columns, h: 3 });
        return widgets;
      });
    },
    [mutate]
  );

  const removeWidget = useCallback(
    (index: number) => mutate((widgets) => widgets.filter((_, i) => i !== index)),
    [mutate]
  );

  const moveWidget = useCallback(
    (index: number, delta: -1 | 1) =>
      mutate((widgets) => {
        const target = index + delta;
        if (target < 0 || target >= widgets.length) return widgets;
        const a = widgets[index];
        const b = widgets[target];
        if (!a || !b) return widgets;
        widgets[index] = b;
        widgets[target] = a;
        return widgets;
      }),
    [mutate]
  );

  const resizeWidget = useCallback(
    (index: number, patch: Partial<Pick<DashboardWidget, 'w' | 'h'>>) =>
      mutate((widgets) => {
        const w = widgets[index];
        if (!w) return widgets;
        const nextW = Math.max(DASHBOARD_GRID.minW, Math.min(DASHBOARD_GRID.columns, patch.w ?? w.w));
        const nextH = Math.max(DASHBOARD_GRID.minH, Math.min(DASHBOARD_GRID.maxH, patch.h ?? w.h));
        // Keep the widget within the grid width after a resize.
        const x = Math.min(w.x, DASHBOARD_GRID.columns - nextW);
        widgets[index] = { ...w, w: nextW, h: nextH, x: Math.max(0, x) };
        return widgets;
      }),
    [mutate]
  );

  const reset = useCallback(() => {
    setSaving(true);
    setSaveError(undefined);
    saveChain.current = saveChain.current
      .then(() => bffClient.resetDashboardLayout())
      .then((data) => {
        setLayout(data);
        setSaving(false);
      })
      .catch((err: unknown) => {
        setSaveError(err instanceof BffError ? err.code : 'INTERNAL_ERROR');
        setSaving(false);
      });
  }, []);

  return {
    status,
    errorCode,
    layout,
    saving,
    saveError,
    reload,
    addWidget,
    removeWidget,
    moveWidget,
    resizeWidget,
    reset
  };
}
