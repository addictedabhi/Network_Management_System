import type { ErrorCode } from '../errors/codes.js';

export interface PageMeta {
  readonly page: number;
  readonly perPage: number;
  readonly total: number;
  readonly hasNext: boolean;
}

export interface ApiSuccess<T> {
  readonly success: true;
  readonly data: T;
  readonly meta?: PageMeta & { readonly requestId?: string };
}

export interface ApiErrorDetail {
  readonly code: ErrorCode;
  readonly message: string;
  readonly field?: string;
}

export interface ApiFailure {
  readonly success: false;
  readonly errors: readonly ApiErrorDetail[];
  readonly meta: { readonly requestId: string };
}

export type Paged<T> = ApiSuccess<readonly T[]> & { readonly meta: PageMeta };
