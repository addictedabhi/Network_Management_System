'use client';

/**
 * A CSP-safe arrangeable dashboard grid (ADR 0010, Phase 3).
 *
 * CSP posture: NO grid LIBRARY is used. Placement is a native CSS grid; each widget's column span
 * and height are expressed with inline `style` ATTRIBUTES (grid-column / grid-row) — the SAME
 * mechanism the shipped UI already uses for bar widths and chart heights (TopInterfaces, EChart).
 * `script-src` stays strict-nonce with NO `unsafe-inline`; no new CSP directive or relaxation is
 * introduced. (Inline `style` attributes fall under the pre-existing `style-src 'unsafe-inline'`,
 * which ECharts already requires — see proxy.ts.) A real cold-load verification under the deployed
 * strict-nonce CSP is confirmed at the deploy/assurance pass, per the standing Next-16 discipline.
 *
 * Reordering/resizing use accessible controls (buttons), not drag-only interactions, so the layout
 * is fully keyboard-operable (NFR-30). Colour is never the sole signal.
 */
import type { ReactNode } from 'react';
import type { DashboardWidget } from '@nms/shared';
import { DASHBOARD_GRID } from '@nms/shared';

export interface ArrangeableGridProps {
  readonly widgets: readonly DashboardWidget[];
  readonly editing: boolean;
  readonly saving: boolean;
  /** Renders the real panel for a widget (from the catalog). */
  readonly renderWidget: (widget: DashboardWidget, index: number) => ReactNode;
  readonly onRemove: (index: number) => void;
  readonly onMove: (index: number, delta: -1 | 1) => void;
  readonly onResize: (index: number, patch: Partial<Pick<DashboardWidget, 'w' | 'h'>>) => void;
  readonly title: (widget: DashboardWidget) => string;
}

export function ArrangeableGrid(props: ArrangeableGridProps) {
  const { widgets, editing, renderWidget, onRemove, onMove, onResize, title } = props;

  if (widgets.length === 0) {
    return (
      <div className="data-state data-state--empty">
        <p>Your dashboard is empty. Use “Add widget” to place a panel.</p>
      </div>
    );
  }

  return (
    <div
      className="arrange-grid"
      // The single grid-template-columns value is a static token, not per-widget data. Kept inline
      // to keep the column count in one place with the shared DASHBOARD_GRID constant.
      style={{ gridTemplateColumns: `repeat(${DASHBOARD_GRID.columns}, minmax(0, 1fr))` }}
    >
      {widgets.map((w, i) => (
        <section
          key={`${w.id}-${i}`}
          className={`arrange-cell panel${editing ? ' arrange-cell--editing' : ''}`}
          style={{ gridColumn: `span ${w.w}`, minHeight: `${w.h * 4}rem` }}
          aria-label={title(w)}
        >
          <header className="arrange-cell__bar">
            <h3 className="panel__title">{title(w)}</h3>
            {editing ? (
              <div className="arrange-cell__controls" role="group" aria-label={`Arrange ${title(w)}`}>
                <button
                  type="button"
                  className="btn btn--ghost btn--icon"
                  onClick={() => onMove(i, -1)}
                  disabled={i === 0}
                  aria-label={`Move ${title(w)} earlier`}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--icon"
                  onClick={() => onMove(i, 1)}
                  disabled={i === widgets.length - 1}
                  aria-label={`Move ${title(w)} later`}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--icon"
                  onClick={() => onResize(i, { w: Math.max(DASHBOARD_GRID.minW, w.w - 2) })}
                  disabled={w.w <= DASHBOARD_GRID.minW}
                  aria-label={`Narrow ${title(w)}`}
                >
                  ⟨
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--icon"
                  onClick={() => onResize(i, { w: Math.min(DASHBOARD_GRID.columns, w.w + 2) })}
                  disabled={w.x + w.w >= DASHBOARD_GRID.columns}
                  aria-label={`Widen ${title(w)}`}
                >
                  ⟩
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--icon"
                  onClick={() => onResize(i, { h: w.h + 1 })}
                  aria-label={`Taller ${title(w)}`}
                >
                  ＋
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--icon"
                  onClick={() => onResize(i, { h: Math.max(DASHBOARD_GRID.minH, w.h - 1) })}
                  disabled={w.h <= DASHBOARD_GRID.minH}
                  aria-label={`Shorter ${title(w)}`}
                >
                  －
                </button>
                <button
                  type="button"
                  className="btn btn--danger btn--icon"
                  onClick={() => onRemove(i)}
                  aria-label={`Remove ${title(w)}`}
                >
                  ✕
                </button>
              </div>
            ) : null}
          </header>
          <div className="arrange-cell__body">{renderWidget(w, i)}</div>
        </section>
      ))}
    </div>
  );
}
