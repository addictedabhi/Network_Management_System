'use client';

/**
 * Explicit loading / error / empty / success rendering for EVERY data view (FR-43). A backend
 * failure never renders as a silent blank: the error branch shows an `role="alert"` message
 * derived from the machine-readable error code (never a raw upstream message) plus a retry action.
 * The empty branch is visually and semantically distinct from the error branch.
 */
import type { ReactNode } from 'react';

export type DataStatus = 'loading' | 'error' | 'empty' | 'success';

export interface DataStateProps {
  readonly status: DataStatus;
  readonly errorCode?: string | undefined;
  readonly onRetry?: (() => void) | undefined;
  /** The entity name for the default empty message, e.g. "devices" → "No devices found." */
  readonly emptyLabel?: string | undefined;
  /** A full replacement for the empty message; overrides `emptyLabel` when provided. */
  readonly emptyMessage?: string | undefined;
  readonly children: () => ReactNode;
}

/** Human copy per machine-readable code. Never surfaces a raw upstream string. */
function errorCopy(code: string | undefined): string {
  switch (code) {
    case 'UPSTREAM_UNAVAILABLE':
      return 'The monitoring backend is currently unavailable. Data cannot be shown right now.';
    case 'UPSTREAM_ERROR':
      return 'The monitoring backend returned an error. Please try again.';
    case 'AUTH_REQUIRED':
    case 'SESSION_EXPIRED':
      return 'Your session has expired. Please sign in again.';
    case 'FORBIDDEN':
      return 'You do not have permission to view this.';
    default:
      return 'Something went wrong while loading this data. Please try again.';
  }
}

export function DataState(props: DataStateProps) {
  const { status, errorCode, onRetry, emptyLabel = 'items', emptyMessage, children } = props;

  if (status === 'loading') {
    return (
      <div role="status" aria-live="polite" className="data-state data-state--loading">
        <span className="spinner" aria-hidden="true" />
        Loading…
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div role="alert" className="data-state data-state--error">
        <p>{errorCopy(errorCode)}</p>
        {onRetry ? (
          <button type="button" onClick={onRetry} className="btn">
            Retry
          </button>
        ) : null}
      </div>
    );
  }

  if (status === 'empty') {
    return (
      <div className="data-state data-state--empty">
        <p>{emptyMessage ?? `No ${emptyLabel} found.`}</p>
      </div>
    );
  }

  return <>{children()}</>;
}
