/**
 * Protected device inventory, detail, interfaces, metrics, and the role-gated admin-portal URL
 * (FR-37..42, ADR 0002). EVERY route requires a valid session; the LibreNMS client and the
 * InfluxMetricsReader are called SERVER-SIDE, and no token ever crosses the wire to the browser.
 *
 * The metric endpoints return the `@nms/shared` `MetricValue` discriminated union directly, so an
 * absent series renders as `unavailable` at the UI (FR-24) — there is no numeric fallback path.
 */
import { Router, type RequestHandler } from 'express';
import type {
  ApiSuccess,
  Paged,
  Device,
  DeviceInterface,
  MetricValue,
  SeriesResponse
} from '@nms/shared';
import { AppError } from '../middleware/errorHandler.js';
import { parsePageQuery } from '../validation/pagination.js';
import { requireRole } from '../middleware/auth.js';
import type { LibreNmsClient } from '../../librenms/client.js';
import type { MetricsReader } from '../../metrics/metricsReader.js';
import type { Logger } from '../../observability/logger.js';

export interface DeviceRoutesDeps {
  readonly librenms: LibreNmsClient;
  readonly metrics: MetricsReader;
  readonly logger: Logger;
  readonly requireSession: RequestHandler;
  /** LibreNMS native UI base URL for the "Open Admin Portal" deep link (FR-40/41). */
  readonly uiBaseUrl: string | undefined;
}

/** Allowlist of metric field names the UI may request. Keeps arbitrary Flux field names out. */
const ALLOWED_METRICS = new Set<string>([
  'ifInOctets_rate',
  'ifOutOctets_rate',
  'af60StaRSSI',
  'af60StaSNR',
  // CPU / memory / AF60 mod-rate — registered in InfluxMetricsReader against the live schema.
  'cpuUsage',
  'memUsedBytes',
  'memFreeBytes',
  'af60TxCapacity',
  'af60RxCapacity'
]);

function pageMeta(page: number, perPage: number, total: number) {
  return { page, perPage, total, hasNext: page * perPage < total };
}

export function createDeviceRouter(deps: DeviceRoutesDeps): Router {
  const router = Router();
  const { requireSession } = deps;

  // GET /api/v1/devices — paginated inventory (FR-37/38).
  router.get('/devices', requireSession, (req, res, next) => {
    void (async () => {
      try {
        const { page, perPage } = parsePageQuery(req.query);
        const hostname = strParam(req.query.hostname);
        const location = strParam(req.query.location);
        const reachability = strParam(req.query.reachability);
        const kind = strParam(req.query.kind);
        const sort = sortColumn(req.query.sort);
        const order = req.query.order === 'desc' ? 'desc' : 'asc';
        const upstream = await deps.librenms.listDevices({
          page,
          perPage,
          ...(hostname ? { hostname } : {}),
          ...(location ? { location } : {}),
          ...(reachability ? { reachability } : {}),
          ...(kind ? { kind } : {}),
          ...(sort ? { sort, order } : {})
        });
        const body: Paged<Device> = {
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

  // GET /api/v1/devices/:id — device detail (FR-39).
  router.get('/devices/:id', requireSession, (req, res, next) => {
    void (async () => {
      try {
        const device = await deps.librenms.getDevice(String(req.params.id));
        const body: ApiSuccess<Device> = { success: true, data: device };
        res.status(200).json(body);
      } catch (err) {
        next(err);
      }
    })();
  });

  // GET /api/v1/devices/:id/interfaces — paginated interface list (FR-39).
  router.get('/devices/:id/interfaces', requireSession, (req, res, next) => {
    void (async () => {
      try {
        const { page, perPage } = parsePageQuery(req.query);
        const upstream = await deps.librenms.listDeviceInterfaces(String(req.params.id), {
          page,
          perPage
        });
        const body: Paged<DeviceInterface> = {
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

  // GET /api/v1/devices/:id/metrics/latest?metric=X[&interfaceId=Y] — a single latest reading.
  // An absent series returns `{ status: 'unavailable', ... }`, NEVER a fabricated 0 (FR-24).
  router.get('/devices/:id/metrics/latest', requireSession, (req, res, next) => {
    void (async () => {
      try {
        const metric = strParam(req.query.metric);
        if (!metric || !ALLOWED_METRICS.has(metric)) {
          throw new AppError('VALIDATION_ERROR', 'Unknown or missing metric name.', 400, 'metric');
        }
        const interfaceId = strParam(req.query.interfaceId);
        const hostname = strParam(req.query.hostname);
        const result = await deps.metrics.queryLatest({
          metric,
          deviceId: String(req.params.id),
          ...(hostname ? { hostname } : {}),
          ...(interfaceId ? { interfaceId } : {})
        });
        const body: ApiSuccess<MetricValue<number>> = { success: true, data: result.value };
        res.status(200).json(body);
      } catch (err) {
        next(err);
      }
    })();
  });

  // GET /api/v1/devices/:id/metrics/series?metric=X&from=…&to=…&step=… — a bounded time-series
  // (FR-22). An absent series is an EMPTY points array, never a fabricated 0 line (FR-24/NFR-22).
  router.get('/devices/:id/metrics/series', requireSession, (req, res, next) => {
    void (async () => {
      try {
        const metric = strParam(req.query.metric);
        if (!metric || !ALLOWED_METRICS.has(metric)) {
          throw new AppError('VALIDATION_ERROR', 'Unknown or missing metric name.', 400, 'metric');
        }
        const from = strParam(req.query.from);
        const to = strParam(req.query.to);
        if (!from || !to || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) {
          throw new AppError('VALIDATION_ERROR', 'A valid from/to time range is required.', 400, 'from');
        }
        const step = strParam(req.query.step) ?? '5m';
        if (!/^\d{1,4}(s|m|h|d)$/.test(step)) {
          throw new AppError('VALIDATION_ERROR', 'Invalid step (e.g. 5m, 1h).', 400, 'step');
        }
        const hostname = strParam(req.query.hostname);
        const interfaceId = strParam(req.query.interfaceId);
        const result = await deps.metrics.querySeries({
          metric,
          deviceId: String(req.params.id),
          from,
          to,
          step,
          ...(hostname ? { hostname } : {}),
          ...(interfaceId ? { interfaceId } : {})
        });
        const body: ApiSuccess<SeriesResponse> = {
          success: true,
          data: {
            metric: result.metric,
            deviceId: result.deviceId,
            ...(result.interfaceId ? { interfaceId: result.interfaceId } : {}),
            points: result.points
          }
        };
        res.status(200).json(body);
      } catch (err) {
        next(err);
      }
    })();
  });

  // GET /api/v1/admin-portal-url — role-gated deep link to the native LibreNMS UI (FR-40/42).
  router.get(
    '/admin-portal-url',
    requireSession,
    requireRole('admin', 'engineer'),
    (req, res, next) => {
      try {
        if (!deps.uiBaseUrl) {
          throw new AppError('UPSTREAM_UNAVAILABLE', 'Admin portal URL is not configured.', 503);
        }
        const deviceId = strParam(req.query.deviceId);
        const base = deps.uiBaseUrl.replace(/\/$/, '');
        const url = deviceId ? `${base}/device/${encodeURIComponent(deviceId)}` : `${base}/`;
        const body: ApiSuccess<{ url: string }> = { success: true, data: { url } };
        res.status(200).json(body);
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}

function strParam(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** Allowlist the sort column so an arbitrary string can never reach the sort key selector. */
function sortColumn(v: unknown): 'hostname' | 'kind' | 'location' | 'reachability' | undefined {
  return v === 'hostname' || v === 'kind' || v === 'location' || v === 'reachability' ? v : undefined;
}
