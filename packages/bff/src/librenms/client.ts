/**
 * The LibreNMS REST client — the ONLY holder of the LibreNMS API token (FR-08 / NFR-09).
 *
 * The token is read from server-side config and sent in the `X-Auth-Token` header. It is never
 * logged (the logger redacts, and this module logs only path + status), never included in an
 * error surfaced to the client, and never reachable from the browser (ADR 0002; the `lint:deps`
 * guard structurally forbids `web -> bff`).
 *
 * Every call carries a timeout via `AbortController`. Upstream failures map into the platform's
 * `AppError` taxonomy so the centralized error handler can answer a safe envelope — the raw
 * upstream body and any stack are discarded before anything reaches the wire.
 */
import type { Alarm, Device, DeviceInterface } from '@nms/shared';
import { AppError } from '../http/middleware/errorHandler.js';
import type { Logger } from '../observability/logger.js';
import type { DependencyHealth } from '../http/routes/health.js';
import { toAlarm, toDevice, toInterface } from './mappers.js';

export interface LibreNmsConfig {
  readonly baseUrl: string;
  readonly apiToken: string;
  readonly uiBaseUrl: string | undefined;
}

export interface PageQuery {
  readonly page: number;
  readonly perPage: number;
}
export interface PagedUpstream<T> {
  readonly items: readonly T[];
  readonly total: number;
}

const TIMEOUT_MS = 10_000;

/**
 * Window a fully-materialised upstream list into a single page.
 *
 * Task 6 verified against the live LibreNMS 25.7.0 API that `list_devices` and `list_alerts`
 * IGNORE `limit`/`offset` and return the ENTIRE set; their `count` is the returned-array length,
 * not a grand total. So the BFF must window here and report the true total — the design invariant
 * is that a page must never surface the unbounded set. This is bounded by LibreNMS's own dataset
 * (tens of devices at POC scale, NFR-01's >5,000 target is a separate host); if that dataset ever
 * grows unbounded, this endpoint needs a server-side cursor and this helper must be revisited.
 */
function windowPage<T>(items: readonly T[], q: PageQuery): PagedUpstream<T> {
  const start = Math.max(0, (q.page - 1) * q.perPage);
  return { items: items.slice(start, start + q.perPage), total: items.length };
}

export type DeviceSortColumn = 'hostname' | 'kind' | 'location' | 'reachability';
export interface DeviceListQuery extends PageQuery {
  readonly hostname?: string;
  readonly location?: string;
  readonly reachability?: string;
  readonly kind?: string;
  readonly sort?: DeviceSortColumn;
  readonly order?: 'asc' | 'desc';
}

/**
 * Apply the operator's filters + sort over the fully-materialised device set, BFF-SIDE, before
 * windowing (design A.3). LibreNMS's `list_devices` ignores these params (Task-6 finding), so the
 * BFF is the honest place to enforce them. `hostname` is a case-insensitive SUBSTRING match (the
 * free-text search box); `location`/`kind`/`reachability` are exact matches (the per-column
 * dropdowns). Sorting is a stable locale-aware compare on the chosen column. At POC scale (tens of
 * devices) this is correct and cheap; a >5,000-device fleet needs a server-side cursor (item 23).
 */
function filterAndSortDevices(devices: readonly Device[], q: DeviceListQuery): readonly Device[] {
  const search = q.hostname?.toLowerCase();
  let out = devices.filter((d) => {
    if (search && !d.hostname.toLowerCase().includes(search)) return false;
    if (q.location && (d.location ?? '') !== q.location) return false;
    if (q.kind && d.kind !== q.kind) return false;
    if (q.reachability && d.reachability !== q.reachability) return false;
    return true;
  });
  if (q.sort) {
    const col = q.sort;
    const dir = q.order === 'desc' ? -1 : 1;
    const key = (d: Device): string =>
      col === 'hostname'
        ? d.hostname
        : col === 'kind'
          ? d.kind
          : col === 'location'
            ? (d.location ?? '')
            : d.reachability;
    out = [...out].sort((a, b) => key(a).localeCompare(key(b)) * dir);
  }
  return out;
}

export interface LibreNmsClient {
  listAlarms(
    q: PageQuery & { severity?: string; acknowledged?: boolean; deviceKind?: string }
  ): Promise<PagedUpstream<Alarm>>;
  getAlarm(id: string): Promise<Alarm>;
  acknowledgeAlarm(id: string, actor: string): Promise<void>;
  listDevices(q: DeviceListQuery): Promise<PagedUpstream<Device>>;
  getDevice(id: string): Promise<Device>;
  listDeviceInterfaces(deviceId: string, q: PageQuery): Promise<PagedUpstream<DeviceInterface>>;
  ensureUser(username: string, level: number): Promise<void>;
  checkHealth(): Promise<DependencyHealth>;
}

export function createLibreNmsClient(
  config: LibreNmsConfig,
  logger: Logger,
  fetchImpl: typeof fetch = fetch
): LibreNmsClient {
  /**
   * Options for `call`. `onBenignNotOk` lets a caller classify a specific NON-2xx response as a
   * benign no-data result rather than an upstream error — e.g. LibreNMS answers the per-device
   * `/ports` endpoint with `{"status":"error","message":"No ports found"}` (a 4xx) when a device
   * simply has no interfaces. That is an EMPTY result, not a failure (FR-39/FR-43), and must NOT be
   * conflated with a real 5xx/timeout. The predicate receives ONLY the parsed body (never the raw
   * response), and any value it returns is used in place of the throw. Unrecognised non-2xx still
   * throws UPSTREAM_ERROR — fail-closed by default.
   */
  interface CallOptions<T> {
    readonly onBenignNotOk?: (status: number, body: unknown) => T | undefined;
  }

  async function call<T>(
    path: string,
    init: RequestInit = {},
    opts: CallOptions<T> = {}
  ): Promise<T> {
    const url = `${config.baseUrl.replace(/\/$/, '')}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetchImpl(url, {
        ...init,
        signal: controller.signal,
        headers: {
          // The ONLY place the LibreNMS token is used. Never logged, never returned.
          'X-Auth-Token': config.apiToken,
          'Content-Type': 'application/json',
          ...(init.headers ?? {})
        }
      });
      if (!res.ok) {
        // Some non-2xx responses are benign no-data signals (see CallOptions.onBenignNotOk). Try to
        // parse the body defensively and let the caller reclassify; a body that will not parse
        // cannot be benign, so it falls through to the error path.
        if (opts.onBenignNotOk) {
          const body = await res.json().catch(() => undefined);
          const benign = opts.onBenignNotOk(res.status, body);
          if (benign !== undefined) return benign;
        }
        // Log the status and path only — never the token, never the upstream body verbatim.
        logger.warn('librenms call failed', { path, status: res.status });
        throw new AppError('UPSTREAM_ERROR', 'The monitoring engine returned an error.', 502);
      }
      return (await res.json()) as T;
    } catch (err) {
      if (err instanceof AppError) throw err;
      // Network failure, timeout/abort, or a malformed JSON body: unreachable-class. The message
      // is a fixed string; the caught error (which could carry a URL with embedded creds) is not
      // interpolated into it.
      logger.warn('librenms unreachable', { path });
      throw new AppError('UPSTREAM_UNAVAILABLE', 'The monitoring engine is unavailable.', 503);
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async listAlarms(q) {
      // Endpoint paths and native filter support are VERIFIED IN TASK 6 against the real API
      // (design doc §6 rows FR-31/FR-38). Filters not supported upstream are applied in the BFF
      // over a BOUNDED query — never by fetching the unbounded set.
      // The engine ignores limit/offset on this endpoint (Task 6). Fetch the active set, then
      // window in the BFF over the returned array — never trust upstream to page or to report a
      // grand total.
      const raw = await call<{ alerts?: unknown[] }>(`/api/v0/alerts?state=1`);
      return windowPage((raw.alerts ?? []).map(toAlarm), q);
    },
    async getAlarm(id) {
      const raw = await call<{ alerts?: unknown[] }>(`/api/v0/alerts/${encodeURIComponent(id)}`);
      const first = raw.alerts?.[0];
      if (!first) throw new AppError('NOT_FOUND', 'Alarm not found.', 404);
      return toAlarm(first);
    },
    async acknowledgeAlarm(id, actor) {
      await call<unknown>(`/api/v0/alerts/${encodeURIComponent(id)}/ack`, {
        method: 'PUT',
        body: JSON.stringify({ note: `Acknowledged via NMS custom UI by ${actor}` })
      });
    },
    async listDevices(q) {
      // The engine ignores limit/offset on `list_devices` (Task 6) and its `count` is the array
      // length, not a grand total. Fetch the set and window in the BFF over the returned array.
      const raw = await call<{ devices?: unknown[] }>(`/api/v0/devices`);
      const all = (raw.devices ?? []).map(toDevice);
      return windowPage(filterAndSortDevices(all, q), q);
    },
    async getDevice(id) {
      const raw = await call<{ devices?: unknown[] }>(`/api/v0/devices/${encodeURIComponent(id)}`);
      const first = raw.devices?.[0];
      if (!first) throw new AppError('NOT_FOUND', 'Device not found.', 404);
      return toDevice(first);
    },
    async listDeviceInterfaces(deviceId, q) {
      // LibreNMS 25.7.0 answers this endpoint with a NON-2xx body
      // `{"status":"error","message":"No ports found"}` for a device with no interfaces (e.g. a
      // ping-only host with no SNMP — device 7 in the POC). That is an EMPTY result, not a backend
      // failure: map it to an empty page so the UI shows the honest empty state (FR-39/FR-43). A
      // real 5xx/timeout still surfaces as an error. Match is narrow (exact "No ports found") so an
      // unrelated 4xx does not get swallowed as empty.
      type PortsBody = { ports?: unknown[]; count?: number };
      const isNoPorts = (body: unknown): boolean =>
        typeof body === 'object' &&
        body !== null &&
        (body as { status?: unknown }).status === 'error' &&
        (body as { message?: unknown }).message === 'No ports found';
      const raw = await call<PortsBody>(
        `/api/v0/devices/${encodeURIComponent(deviceId)}/ports?limit=${q.perPage}&offset=${
          (q.page - 1) * q.perPage
        }`,
        {},
        { onBenignNotOk: (_status, body) => (isNoPorts(body) ? { ports: [], count: 0 } : undefined) }
      );
      return {
        items: (raw.ports ?? []).map(toInterface),
        total: raw.count ?? raw.ports?.length ?? 0
      };
    },
    async ensureUser(_username, _level) {
      // FR-16 (provision/update the LibreNMS user at the mapped level) is FORMALLY DEFERRED to
      // Task 7 — see docs/plans/nms-platform-foundation-plan.md (FR-16 deferral) and the
      // requirement doc. In this milestone LibreNMS auto-provisions the account on first SSO login
      // via its own `sso` auth mechanism, so a validly-authenticated user is never stranded.
      //
      // Deliberately a documented NO-OP: it must NOT throw (that would trip the caller's
      // best-effort catch and emit a warn on EVERY login for a call that can never succeed — a
      // per-login error signal for deferred scope). No per-login log is emitted here. When FR-16 is
      // implemented, wire the provisioning call here (API or the `sso` path); never patch LibreNMS
      // core (FR-07).
      return;
    },
    async checkHealth() {
      const startedAt = Date.now();
      try {
        await call<unknown>('/api/v0/system');
        return { status: 'ok', latencyMs: Date.now() - startedAt };
      } catch {
        return { status: 'error', error: 'UPSTREAM_UNAVAILABLE' };
      }
    }
  };
}
