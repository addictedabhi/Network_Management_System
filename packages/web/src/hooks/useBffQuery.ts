'use client';

/**
 * A tiny data-fetching state machine so every view gets loading / error / empty / success without
 * repeating the boilerplate (FR-43). It deliberately does NOT swallow errors into an empty result:
 * an error is `status: 'error'` with the machine-readable code, distinct from `status: 'empty'`.
 */
import { useCallback, useEffect, useState } from 'react';
import { BffError } from '../lib/bffClient';
import type { DataStatus } from '../components/DataState';

export interface QueryResult<T> {
  readonly status: DataStatus;
  readonly data: T | undefined;
  readonly errorCode: string | undefined;
  readonly reload: () => void;
}

/**
 * @param fetcher async function returning the data
 * @param isEmpty predicate deciding whether a successful result is "empty" (drives the empty state)
 */
export function useBffQuery<T>(
  fetcher: () => Promise<T>,
  isEmpty: (data: T) => boolean = () => false,
  deps: readonly unknown[] = []
): QueryResult<T> {
  const [status, setStatus] = useState<DataStatus>('loading');
  const [data, setData] = useState<T | undefined>(undefined);
  const [errorCode, setErrorCode] = useState<string | undefined>(undefined);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setErrorCode(undefined);
    fetcher()
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setStatus(isEmpty(result) ? 'empty' : 'success');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const code = err instanceof BffError ? err.code : 'INTERNAL_ERROR';
        setErrorCode(code);
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce, ...deps]);

  return { status, data, errorCode, reload };
}
