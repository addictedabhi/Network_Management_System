'use client';

/**
 * View-state for the enhanced device table: sort, per-column filters (type/location/reachability),
 * free-text hostname search, and pagination. All of these are expressed as BFF query params and
 * applied SERVER-SIDE (the BFF fetches the LibreNMS set, then filters/sorts/windows it — Task-6
 * `windowPage`). The client never receives an unbounded set, and `meta.total` stays accurate.
 *
 * `>5,000` caveat (item 23): fetch-then-window does not scale past a few thousand devices; a real
 * server-side cursor is future work. This is stated in the UI dev note, not silently pretended.
 */
import { useMemo, useState } from 'react';

export type SortColumn = 'hostname' | 'kind' | 'location' | 'reachability';
export type SortDir = 'asc' | 'desc';

export interface DeviceTableState {
  readonly search: string;
  readonly kind: string;
  readonly location: string;
  readonly reachability: string;
  readonly sortColumn: SortColumn;
  readonly sortDir: SortDir;
  readonly page: number;
  readonly perPage: number;
}

export const DEFAULT_TABLE_STATE: DeviceTableState = {
  search: '',
  kind: '',
  location: '',
  reachability: '',
  sortColumn: 'hostname',
  sortDir: 'asc',
  page: 1,
  perPage: 25
};

/** Serialise the view-state into a BFF `/api/v1/devices` query string. Empty filters are omitted. */
export function toDeviceQuery(s: DeviceTableState): string {
  const qs = new URLSearchParams();
  qs.set('page', String(s.page));
  qs.set('perPage', String(s.perPage));
  if (s.search) qs.set('hostname', s.search);
  if (s.kind) qs.set('kind', s.kind);
  if (s.location) qs.set('location', s.location);
  if (s.reachability) qs.set('reachability', s.reachability);
  qs.set('sort', s.sortColumn);
  qs.set('order', s.sortDir);
  return qs.toString();
}

export function useDeviceTableState() {
  const [state, setState] = useState<DeviceTableState>(DEFAULT_TABLE_STATE);

  const actions = useMemo(
    () => ({
      /** Set a filter/search value and reset to page 1 (the result set changed). */
      setFilter(key: 'search' | 'kind' | 'location' | 'reachability', value: string) {
        setState((s) => ({ ...s, [key]: value, page: 1 }));
      },
      /** Toggle sort: clicking the active column flips direction; a new column sorts ascending. */
      toggleSort(column: SortColumn) {
        setState((s) =>
          s.sortColumn === column
            ? { ...s, sortDir: s.sortDir === 'asc' ? 'desc' : 'asc' }
            : { ...s, sortColumn: column, sortDir: 'asc' }
        );
      },
      setPage(page: number) {
        setState((s) => ({ ...s, page: Math.max(1, page) }));
      },
      reset() {
        setState(DEFAULT_TABLE_STATE);
      }
    }),
    []
  );

  return { state, query: toDeviceQuery(state), ...actions };
}
