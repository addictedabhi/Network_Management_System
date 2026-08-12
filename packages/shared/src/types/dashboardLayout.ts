/**
 * Custom-UI dashboard layout (ADR 0010). A per-user, single personal layout over the REAL panels
 * the custom UI ships — an ordered list of placed widgets. Persisted server-side in Redis under a
 * key derived from the session `sub` ONLY (never client input), so there is no cross-user surface.
 *
 * The widget-id allowlist lives here so the BFF (Zod validation) and the web catalog agree on
 * exactly one set — a widget id the UI cannot render must never validate on the write path, and a
 * new panel is added in one place.
 */

/** The real panels a user may place. No id outside this set is accepted by the layout write. */
export const DASHBOARD_WIDGET_IDS = [
  'FleetKpiTiles',
  'P2PLinkMatrix',
  'TopInterfaces',
  'ThroughputChart',
  'CpuMemHeatmap',
  'AlarmFeed',
  'DeviceKpiPanel',
  'FleetCpuTrend'
] as const;

export type DashboardWidgetId = (typeof DASHBOARD_WIDGET_IDS)[number];

/** Bounds for the placement grid. Geometry outside these is rejected server-side. */
export const DASHBOARD_GRID = {
  /** Number of columns the arrangeable grid exposes. */
  columns: 12,
  /** Max widgets a single layout may contain (bounds the payload + the render cost). */
  maxWidgets: 24,
  minW: 1,
  minH: 1,
  maxH: 24
} as const;

export interface DashboardWidget {
  readonly id: DashboardWidgetId;
  /** Column index (0-based) of the widget's top-left cell. */
  readonly x: number;
  /** Row index (0-based) of the widget's top-left cell. */
  readonly y: number;
  /** Width in grid columns. */
  readonly w: number;
  /** Height in grid rows. */
  readonly h: number;
  /** Optional bounded widget params (e.g. a deviceId for DeviceKpiPanel). */
  readonly params?: { readonly deviceId?: string };
}

export interface DashboardLayout {
  readonly version: 'v1';
  readonly widgets: readonly DashboardWidget[];
}
