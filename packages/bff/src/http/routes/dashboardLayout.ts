/**
 * Dashboard layout routes (ADR 0010, Phase 3 customisable dashboard).
 *
 * GET  /api/v1/dashboard/layout — the caller's personal layout, or a sensible DEFAULT layout when
 *      none is stored (a first-class empty, never an error). Read is session-gated.
 * PUT  /api/v1/dashboard/layout — Zod-validated FULL replace. Session-gated + CSRF header + size-
 *      limited body; the widget-id allowlist and bounded geometry come from the shared schema.
 * DELETE /api/v1/dashboard/layout — reset to default (delete the key). Session-gated + CSRF.
 *
 * PER-USER SCOPE IS STRUCTURAL: the storage key is derived from the session subject
 * (`res.locals.session.subject`) ONLY. No route reads a user id from the path/query/body, so there
 * is no request parameter that could address another user's layout — no IDOR surface (NFR-11).
 * This is enforced by construction, not by a trusted-client check.
 */
import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import type { ApiSuccess, DashboardLayout } from '@nms/shared';
import { DASHBOARD_WIDGET_IDS, DASHBOARD_GRID } from '@nms/shared';
import { AppError } from '../middleware/errorHandler.js';
import { requireCsrfHeader } from '../middleware/auth.js';
import type { LayoutStore } from '../../dashboard/layoutStore.js';
import type { SessionRecord } from '../../auth/sessionStore.js';
import type { Logger } from '../../observability/logger.js';

export interface DashboardLayoutRoutesDeps {
  readonly layouts: LayoutStore;
  readonly logger: Logger;
  readonly requireSession: RequestHandler;
}

/**
 * The default layout returned when a user has never saved one. Real panels only; a compact
 * starting arrangement the user can then rearrange. Kept small and honest — no fabricated params.
 */
const DEFAULT_LAYOUT: DashboardLayout = {
  version: 'v1',
  widgets: [
    { id: 'FleetKpiTiles', x: 0, y: 0, w: 12, h: 2 },
    { id: 'P2PLinkMatrix', x: 0, y: 2, w: 12, h: 4 },
    { id: 'AlarmFeed', x: 0, y: 6, w: 6, h: 4 },
    { id: 'CpuMemHeatmap', x: 6, y: 6, w: 6, h: 4 }
  ]
};

/**
 * The validation contract for a layout write. Strict mode rejects unknown keys; the widget id is
 * an allowlist enum; geometry is bounded to the grid. A payload that fails any of these is a 400
 * VALIDATION_ERROR — it never reaches the store.
 */
const WidgetSchema = z
  .object({
    id: z.enum(DASHBOARD_WIDGET_IDS),
    x: z.number().int().min(0).max(DASHBOARD_GRID.columns - 1),
    y: z.number().int().min(0).max(1000),
    w: z.number().int().min(DASHBOARD_GRID.minW).max(DASHBOARD_GRID.columns),
    h: z.number().int().min(DASHBOARD_GRID.minH).max(DASHBOARD_GRID.maxH),
    // Bounded, strict optional params. A deviceId is a short numeric-ish string; reject anything
    // large or unknown-keyed. `.optional()` keeps params absent for widgets that need none.
    params: z
      .object({ deviceId: z.string().min(1).max(32).optional() })
      .strict()
      .optional()
  })
  .strict()
  // A widget must fit within the grid horizontally (x + w <= columns).
  .refine((wgt) => wgt.x + wgt.w <= DASHBOARD_GRID.columns, {
    message: 'widget exceeds grid width'
  });

const LayoutSchema = z
  .object({
    version: z.literal('v1'),
    widgets: z.array(WidgetSchema).max(DASHBOARD_GRID.maxWidgets)
  })
  .strict();

/** Hard cap on the raw request body regardless of the express.json limit — a small JSON doc. */
const MAX_BODY_BYTES = 16 * 1024;

export function createDashboardLayoutRouter(deps: DashboardLayoutRoutesDeps): Router {
  const router = Router();
  const { requireSession, layouts } = deps;

  const subjectOf = (res: import('express').Response): string => {
    const session = res.locals.session as SessionRecord | undefined;
    // requireSession guarantees a session; this is a defensive invariant, not a request read.
    if (!session?.subject) throw new AppError('AUTH_REQUIRED', 'Authentication required.', 401);
    return session.subject;
  };

  // GET — read the caller's layout; default when none stored. Per-user key from the session only.
  router.get('/dashboard/layout', requireSession, (_req, res, next) => {
    void (async () => {
      try {
        const stored = await layouts.get(subjectOf(res));
        const body: ApiSuccess<DashboardLayout> = {
          success: true,
          data: stored ?? DEFAULT_LAYOUT
        };
        res.status(200).json(body);
      } catch (err) {
        next(err);
      }
    })();
  });

  // PUT — Zod-validated full replace. CSRF header required (state-changing). Size-limited.
  router.put('/dashboard/layout', requireSession, requireCsrfHeader(), (req, res, next) => {
    void (async () => {
      try {
        // Defensive size cap independent of body-parser: reject an oversized payload before parse.
        const contentLength = Number(req.headers['content-length'] ?? 0);
        if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
          throw new AppError('PAYLOAD_TOO_LARGE', 'Layout payload too large.', 413);
        }
        const parsed = LayoutSchema.safeParse(req.body);
        if (!parsed.success) {
          const first = parsed.error.issues[0];
          throw new AppError(
            'VALIDATION_ERROR',
            'Invalid dashboard layout.',
            400,
            first?.path.join('.') || undefined
          );
        }
        // Normalise the validated data into the shared shape: omit `params` entirely when absent
        // (rather than `params: undefined`) so it satisfies exactOptionalPropertyTypes and the
        // stored value stays clean.
        const layout: DashboardLayout = {
          version: 'v1',
          widgets: parsed.data.widgets.map((w) => ({
            id: w.id,
            x: w.x,
            y: w.y,
            w: w.w,
            h: w.h,
            ...(w.params?.deviceId ? { params: { deviceId: w.params.deviceId } } : {})
          }))
        };
        // Freeze the write to the session subject ONLY — no user id is read from the request.
        await layouts.put(subjectOf(res), layout);
        const body: ApiSuccess<DashboardLayout> = { success: true, data: layout };
        res.status(200).json(body);
      } catch (err) {
        next(err);
      }
    })();
  });

  // DELETE — reset to default (delete the key). CSRF header required.
  router.delete('/dashboard/layout', requireSession, requireCsrfHeader(), (_req, res, next) => {
    void (async () => {
      try {
        await layouts.delete(subjectOf(res));
        const body: ApiSuccess<DashboardLayout> = { success: true, data: DEFAULT_LAYOUT };
        res.status(200).json(body);
      } catch (err) {
        next(err);
      }
    })();
  });

  return router;
}

export { DEFAULT_LAYOUT };
