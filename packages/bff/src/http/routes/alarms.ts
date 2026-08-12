/**
 * Alarm console routes (FR-30..35). Every route requires a valid session; the LibreNMS client is
 * called SERVER-SIDE and no token ever crosses the wire to the browser.
 *
 * Listing is server-side paginated over the LibreNMS alerts API (the client windows the returned
 * set — see `windowPage` in librenms/client.ts — because LibreNMS ignores limit/offset, Task 6).
 * An empty active-alarm set is a first-class EMPTY result (`data: []`, `total: 0`), never a
 * fabricated row.
 *
 * Acknowledge is a STATE-CHANGING, ROLE-GATED action: only `admin`/`engineer` may ack (FR-34,
 * NFR-11). The gate is enforced SERVER-SIDE here — `readonly` and `operator` receive 403 and the
 * upstream ack is never called. Hiding the button in the UI is presentation, not the control. The
 * acknowledger identity is taken from the SERVER-SIDE session (FR-32), never from the request body.
 */
import { Router, type RequestHandler } from 'express';
import type { ApiSuccess, Paged, Alarm, AlertLogEntry } from '@nms/shared';
import { AppError } from '../middleware/errorHandler.js';
import { parsePageQuery } from '../validation/pagination.js';
import { requireRole, requireCsrfHeader } from '../middleware/auth.js';
import type { LibreNmsClient } from '../../librenms/client.js';
import type { SessionRecord } from '../../auth/sessionStore.js';
import type { Logger } from '../../observability/logger.js';

export interface AlarmRoutesDeps {
  readonly librenms: LibreNmsClient;
  readonly logger: Logger;
  readonly requireSession: RequestHandler;
}

/** Severities the UI may filter by — an allowlist keeps arbitrary strings out of the upstream call. */
const ALLOWED_SEVERITIES = new Set<string>(['critical', 'warning', 'ok']);

function pageMeta(page: number, perPage: number, total: number) {
  return { page, perPage, total, hasNext: page * perPage < total };
}

export function createAlarmRouter(deps: AlarmRoutesDeps): Router {
  const router = Router();
  const { requireSession } = deps;

  // GET /api/v1/alarms — paginated + filtered active alarms (FR-30/31/38).
  router.get('/alarms', requireSession, (req, res, next) => {
    void (async () => {
      try {
        const { page, perPage } = parsePageQuery(req.query);
        const severity = strParam(req.query.severity);
        if (severity && !ALLOWED_SEVERITIES.has(severity)) {
          throw new AppError('VALIDATION_ERROR', 'Unknown severity filter.', 400, 'severity');
        }
        const acknowledged = boolParam(req.query.acknowledged);
        const deviceKind = strParam(req.query.deviceKind);
        const upstream = await deps.librenms.listAlarms({
          page,
          perPage,
          ...(severity ? { severity } : {}),
          ...(acknowledged !== undefined ? { acknowledged } : {}),
          ...(deviceKind ? { deviceKind } : {})
        });
        const body: Paged<Alarm> = {
          success: true,
          data: upstream.items,
          meta: pageMeta(page, perPage, upstream.total)
        };
        res.status(200).json(body);
      } catch (err) {
        next(err);
      }
    })();
  });

  // GET /api/v1/alarms/:id/history — alert state-transition timeline (N1). A READ, so it is
  // session-gated only (no role gate — reading history is not a privileged, state-changing action).
  // LibreNMS scopes alertlog by DEVICE, so we resolve the alarm's device first, then page the
  // device's alert log server-side (real total). A missing alarm is a clean 404.
  router.get('/alarms/:id/history', requireSession, (req, res, next) => {
    void (async () => {
      try {
        const { page, perPage } = parsePageQuery(req.query);
        const alarm = await deps.librenms.getAlarm(String(req.params.id));
        const upstream = await deps.librenms.listAlarmHistory(alarm.deviceId, { page, perPage });
        const body: Paged<AlertLogEntry> = {
          success: true,
          data: upstream.items,
          meta: pageMeta(page, perPage, upstream.total)
        };
        res.status(200).json(body);
      } catch (err) {
        next(err);
      }
    })();
  });

  // POST /api/v1/alarms/:id/ack — acknowledge (FR-33/34/35). Role-gated SERVER-SIDE to
  // admin/engineer; readonly/operator get 403 and the upstream ack is never reached. CSRF header
  // required because it is state-changing (ADR 0003).
  router.post(
    '/alarms/:id/ack',
    requireSession,
    requireCsrfHeader(),
    requireRole('admin', 'engineer'),
    (req, res, next) => {
      void (async () => {
        try {
          const session = res.locals.session as SessionRecord;
          const id = String(req.params.id);
          // Actor identity is the server-side session username — never trusted from the request.
          await deps.librenms.acknowledgeAlarm(id, session.username);
          const body: ApiSuccess<{ id: string; acknowledged: true }> = {
            success: true,
            data: { id, acknowledged: true }
          };
          res.status(200).json(body);
        } catch (err) {
          next(err);
        }
      })();
    }
  );

  return router;
}

function strParam(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** Parse a strict `true`/`false` query param; anything else is treated as "unset". */
function boolParam(v: unknown): boolean | undefined {
  if (v === 'true') return true;
  if (v === 'false') return false;
  return undefined;
}
