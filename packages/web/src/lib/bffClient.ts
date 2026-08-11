/**
 * The ONLY way the UI reaches data. Every call is a same-origin `/bff/...` request that carries
 * the opaque session cookie (`credentials: 'include'`) — NEVER a token, client secret, or any
 * other credential. There is no LibreNMS/InfluxDB path here (ADR 0002); the BFF is the sole data
 * plane. `@nms/web` imports `@nms/shared` types only — never `@nms/bff` (ADR 0001, enforced by
 * `lint:deps`).
 */
import type {
  ApiFailure,
  SessionInfo,
  Device,
  DeviceInterface,
  MetricValue,
  PageMeta,
  Alarm,
  SeriesResponse
} from '@nms/shared';

const BFF_PREFIX = '/bff';
const CSRF_HEADER = 'x-requested-with';
const CSRF_VALUE = 'nms-ui';

export class BffError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'BffError';
  }
}

type Envelope<T> = { success: boolean; data?: T; meta?: PageMeta } & Partial<ApiFailure>;

async function request<T>(
  path: string,
  init: RequestInit = {}
): Promise<{ data: T; meta?: PageMeta | undefined }> {
  const res = await fetch(`${BFF_PREFIX}${path}`, {
    ...init,
    // The opaque session cookie is the ONLY credential the browser holds (FR-12).
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      [CSRF_HEADER]: CSRF_VALUE,
      ...(init.headers ?? {})
    }
  });

  let body: Envelope<T>;
  try {
    body = (await res.json()) as Envelope<T>;
  } catch {
    throw new BffError('INTERNAL_ERROR', 'The server response could not be read.', res.status);
  }

  if (!res.ok || !body.success) {
    const first = body.errors?.[0];
    // 401 → the UI should send the user through the BFF login (FR-17). The caller decides how to
    // react; we surface the code so the redirect can be centralized in the app shell.
    throw new BffError(first?.code ?? 'INTERNAL_ERROR', first?.message ?? 'Request failed.', res.status);
  }
  return { data: body.data as T, meta: body.meta };
}

export const bffClient = {
  getSession: () => request<SessionInfo>('/api/v1/session').then((r) => r.data),

  listDevices: (query = '') =>
    request<readonly Device[]>(`/api/v1/devices${query ? `?${query}` : ''}`),

  getDevice: (id: string) => request<Device>(`/api/v1/devices/${encodeURIComponent(id)}`).then((r) => r.data),

  listDeviceInterfaces: (id: string, query = '') =>
    request<readonly DeviceInterface[]>(
      `/api/v1/devices/${encodeURIComponent(id)}/interfaces${query ? `?${query}` : ''}`
    ),

  getLatestMetric: (id: string, metric: string, opts: { hostname?: string; interfaceId?: string } = {}) => {
    const qs = new URLSearchParams({
      metric,
      ...(opts.hostname ? { hostname: opts.hostname } : {}),
      ...(opts.interfaceId ? { interfaceId: opts.interfaceId } : {})
    });
    return request<MetricValue<number>>(
      `/api/v1/devices/${encodeURIComponent(id)}/metrics/latest?${qs.toString()}`
    ).then((r) => r.data);
  },

  getSeriesMetric: (
    id: string,
    metric: string,
    range: { from: string; to: string; step: string },
    opts: { hostname?: string; interfaceId?: string } = {}
  ) => {
    const qs = new URLSearchParams({
      metric,
      from: range.from,
      to: range.to,
      step: range.step,
      ...(opts.hostname ? { hostname: opts.hostname } : {}),
      ...(opts.interfaceId ? { interfaceId: opts.interfaceId } : {})
    });
    return request<SeriesResponse>(
      `/api/v1/devices/${encodeURIComponent(id)}/metrics/series?${qs.toString()}`
    ).then((r) => r.data);
  },

  getAdminPortalUrl: (deviceId?: string) => {
    const qs = deviceId ? `?deviceId=${encodeURIComponent(deviceId)}` : '';
    return request<{ url: string }>(`/api/v1/admin-portal-url${qs}`).then((r) => r.data);
  },

  /** Active alarms, optionally filtered by severity (FR-30/31). Returns data + meta (real total). */
  listAlarms: (query = '') =>
    request<readonly Alarm[]>(`/api/v1/alarms${query ? `?${query}` : ''}`),

  /**
   * Acknowledge an alarm (FR-33/34). The server RE-DERIVES authorization: readonly/operator get a
   * 403 regardless of any UI state. Hiding the button is presentation only, never the control.
   */
  ackAlarm: (id: string) =>
    request<{ id: string; acknowledged: true }>(`/api/v1/alarms/${encodeURIComponent(id)}/ack`, {
      method: 'POST'
    }).then((r) => r.data)
};

/** The login endpoint is a top-level navigation, not a fetch (it 302s to Keycloak). */
export const LOGIN_URL = `${BFF_PREFIX}/auth/login`;
export const LOGOUT_URL = `${BFF_PREFIX}/auth/logout`;
