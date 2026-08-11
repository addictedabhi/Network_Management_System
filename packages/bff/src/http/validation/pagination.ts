/**
 * Page-query validation (FR-38). Rejects anything that would let a client request an unbounded
 * result set — the cap is enforced HERE, at the boundary, before any upstream call.
 */
import { AppError } from '../middleware/errorHandler.js';

export const DEFAULT_PER_PAGE = 50;
export const MAX_PER_PAGE = 200;

export function parsePageQuery(query: unknown): { page: number; perPage: number } {
  const q = (query ?? {}) as Record<string, unknown>;
  const page = parsePositiveInt(q.page, 1, 'page');
  const perPage = parsePositiveInt(q.perPage, DEFAULT_PER_PAGE, 'perPage');
  if (perPage > MAX_PER_PAGE) {
    throw new AppError('VALIDATION_ERROR', `perPage must not exceed ${MAX_PER_PAGE}.`, 400, 'perPage');
  }
  return { page, perPage };
}

function parsePositiveInt(raw: unknown, fallback: number, field: string): number {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const s = String(raw);
  if (!/^\d+$/.test(s)) {
    throw new AppError('VALIDATION_ERROR', `${field} must be a positive integer.`, 400, field);
  }
  const n = Number(s);
  if (!Number.isInteger(n) || n < 1) {
    throw new AppError('VALIDATION_ERROR', `${field} must be a positive integer.`, 400, field);
  }
  return n;
}
