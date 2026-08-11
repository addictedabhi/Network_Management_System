import { describe, it, expect, vi } from 'vitest';
import { createLibreNmsClient } from '../../src/librenms/client.js';
import { createLogger } from '../../src/observability/logger.js';

const logger = createLogger({ logLevel: 'error' });
const config = { baseUrl: 'http://lnms.test', apiToken: 'super-secret-token', uiBaseUrl: undefined };

describe('LibreNmsClient', () => {
  it('sends the API token in the X-Auth-Token header', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ devices: [], count: 0 }), { status: 200 })
    );
    const client = createLibreNmsClient(config, logger, fetchMock as unknown as typeof fetch);
    await client.listDevices({ page: 1, perPage: 50 });
    const [, init] = fetchMock.mock.calls[0]!;
    expect((init as RequestInit).headers).toMatchObject({ 'X-Auth-Token': 'super-secret-token' });
  });

  it('throws UPSTREAM_UNAVAILABLE when the network fails', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    const client = createLibreNmsClient(config, logger, fetchMock as unknown as typeof fetch);
    await expect(client.listDevices({ page: 1, perPage: 50 })).rejects.toMatchObject({
      code: 'UPSTREAM_UNAVAILABLE',
      status: 503
    });
  });

  it('throws UPSTREAM_ERROR on a 500 and never includes the token in the error', async () => {
    const fetchMock = vi.fn(async () => new Response('boom super-secret-token', { status: 500 }));
    const client = createLibreNmsClient(config, logger, fetchMock as unknown as typeof fetch);
    await expect(client.listDevices({ page: 1, perPage: 50 })).rejects.toSatisfy((err: Error) => {
      expect((err as { code?: string }).code).toBe('UPSTREAM_ERROR');
      expect(err.message).not.toContain('super-secret-token');
      expect(err.message).not.toContain('boom');
      return true;
    });
  });

  it('maps a 4xx upstream to a generic UPSTREAM_ERROR (no upstream body leak)', async () => {
    const fetchMock = vi.fn(async () => new Response('forbidden token=super-secret-token', { status: 403 }));
    const client = createLibreNmsClient(config, logger, fetchMock as unknown as typeof fetch);
    await expect(client.listDevices({ page: 1, perPage: 50 })).rejects.toSatisfy((err: Error) => {
      expect(err.message).not.toContain('super-secret-token');
      return true;
    });
  });

  it('acknowledgeAlarm rejects rather than resolving when upstream fails (FR-35)', async () => {
    const fetchMock = vi.fn(async () => new Response('nope', { status: 500 }));
    const client = createLibreNmsClient(config, logger, fetchMock as unknown as typeof fetch);
    await expect(client.acknowledgeAlarm('42', 'alice')).rejects.toBeDefined();
  });

  it('acknowledgeAlarm sends a PUT with an actor-attributed note', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: 'ok' }), { status: 200 }));
    const client = createLibreNmsClient(config, logger, fetchMock as unknown as typeof fetch);
    await client.acknowledgeAlarm('42', 'alice');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain('/api/v0/alerts/42/ack');
    expect((init as RequestInit).method).toBe('PUT');
    expect(String((init as RequestInit).body)).toContain('alice');
  });

  it('getDevice throws NOT_FOUND when the engine returns no device', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ devices: [] }), { status: 200 }));
    const client = createLibreNmsClient(config, logger, fetchMock as unknown as typeof fetch);
    await expect(client.getDevice('999')).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });

  it('applies a request timeout via an AbortSignal', async () => {
    const fetchMock = vi.fn(async (_url: unknown, init: RequestInit) => {
      expect(init.signal).toBeDefined();
      return new Response(JSON.stringify({ devices: [], count: 0 }), { status: 200 });
    });
    const client = createLibreNmsClient(config, logger, fetchMock as unknown as typeof fetch);
    await client.listDevices({ page: 1, perPage: 50 });
    expect(fetchMock).toHaveBeenCalled();
  });

  // --- Task 6 real-API finding: LibreNMS `list_devices` and `list_alerts` IGNORE limit/offset and
  // return the FULL set; their `count` is the returned-array length, not a grand total. The BFF must
  // therefore window client-side and report the true total (design invariant: never surface the
  // unbounded set as a page). Verified live against LibreNMS 25.7.0 on 2026-08-11.
  it('windows devices in the BFF when the engine ignores limit/offset (FR-38)', async () => {
    const sevenDevices = Array.from({ length: 7 }, (_, i) => ({ device_id: i + 1, hostname: `d${i + 1}` }));
    // The engine returns ALL seven regardless of the limit/offset in the query string.
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ devices: sevenDevices, count: 7 }), { status: 200 })
    );
    const client = createLibreNmsClient(config, logger, fetchMock as unknown as typeof fetch);

    const page1 = await client.listDevices({ page: 1, perPage: 2 });
    expect(page1.items).toHaveLength(2);
    expect(page1.total).toBe(7);
    expect(page1.items.map((d) => d.id)).toEqual(['1', '2']);

    const page2 = await client.listDevices({ page: 2, perPage: 2 });
    expect(page2.items).toHaveLength(2);
    expect(page2.total).toBe(7);
    expect(page2.items.map((d) => d.id)).toEqual(['3', '4']);

    const lastPage = await client.listDevices({ page: 4, perPage: 2 });
    expect(lastPage.items).toHaveLength(1);
    expect(lastPage.total).toBe(7);
    expect(lastPage.items.map((d) => d.id)).toEqual(['7']);
  });

  // --- Enhanced device table (Item 2): LibreNMS `list_devices` ignores filter/sort params (Task-6),
  // so the BFF applies hostname search + per-column filters + sort over the fetched set before
  // windowing (design A.3). These prove that behaviour end-to-end through the client.
  it('filters devices by hostname substring + exact kind, and reports the filtered total', async () => {
    const devices = [
      { device_id: 1, hostname: 'sim-switch-01', os: 'linux', type: 'network', location: 'lab' },
      { device_id: 2, hostname: 'sim-router-01', os: 'linux', type: 'network', location: 'lab' },
      { device_id: 3, hostname: 'sim-radio-01', os: 'airos-af60', type: 'wireless', location: 'roof' }
    ];
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ devices, count: 3 }), { status: 200 })
    );
    const client = createLibreNmsClient(config, logger, fetchMock as unknown as typeof fetch);
    const res = await client.listDevices({ page: 1, perPage: 25, hostname: 'RADIO' });
    expect(res.total).toBe(1);
    expect(res.items.map((d) => d.hostname)).toEqual(['sim-radio-01']);
  });

  it('sorts devices by a column in the requested direction (design A.3)', async () => {
    const devices = [
      { device_id: 1, hostname: 'bravo', os: 'linux', type: 'network', location: 'lab' },
      { device_id: 2, hostname: 'alpha', os: 'linux', type: 'network', location: 'lab' },
      { device_id: 3, hostname: 'charlie', os: 'linux', type: 'network', location: 'lab' }
    ];
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ devices, count: 3 }), { status: 200 })
    );
    const client = createLibreNmsClient(config, logger, fetchMock as unknown as typeof fetch);
    const asc = await client.listDevices({ page: 1, perPage: 25, sort: 'hostname', order: 'asc' });
    expect(asc.items.map((d) => d.hostname)).toEqual(['alpha', 'bravo', 'charlie']);
    const desc = await client.listDevices({ page: 1, perPage: 25, sort: 'hostname', order: 'desc' });
    expect(desc.items.map((d) => d.hostname)).toEqual(['charlie', 'bravo', 'alpha']);
  });

  it('windows alarms in the BFF when the engine ignores limit/offset (FR-31/FR-38)', async () => {
    const fiveAlerts = Array.from({ length: 5 }, (_, i) => ({
      id: i + 1,
      device_id: 1,
      rule_name: 'r',
      severity: 'warning',
      state: 1,
      timestamp: '2026-08-11 00:00:00'
    }));
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ alerts: fiveAlerts, count: 5 }), { status: 200 })
    );
    const client = createLibreNmsClient(config, logger, fetchMock as unknown as typeof fetch);

    const page1 = await client.listAlarms({ page: 1, perPage: 2 });
    expect(page1.items).toHaveLength(2);
    expect(page1.total).toBe(5);

    const page3 = await client.listAlarms({ page: 3, perPage: 2 });
    expect(page3.items).toHaveLength(1);
    expect(page3.total).toBe(5);
  });

  // --- FR-39/FR-43 (Item 1): LibreNMS per-device `/ports` returns a non-2xx body
  // `{"status":"error","message":"No ports found"}` for a device with no ports (e.g. a ping-only
  // host with no SNMP). That is a BENIGN no-data result, NOT an upstream failure — the BFF must map
  // it to an EMPTY page so the UI renders the honest empty state, distinct from a real 5xx error.
  it('maps LibreNMS "No ports found" to an EMPTY page, not an error (FR-39/FR-43)', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ status: 'error', message: 'No ports found' }), {
          status: 400
        })
    );
    const client = createLibreNmsClient(config, logger, fetchMock as unknown as typeof fetch);
    const page = await client.listDeviceInterfaces('7', { page: 1, perPage: 100 });
    expect(page.items).toEqual([]);
    expect(page.total).toBe(0);
  });

  it('returns the interface set when LibreNMS has ports (FR-39)', async () => {
    const ports = [
      { port_id: 11, ifName: 'eth0', ifAdminStatus: 'up', ifOperStatus: 'up' },
      { port_id: 12, ifName: 'eth1', ifAdminStatus: 'down', ifOperStatus: 'down' }
    ];
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ ports, count: 2 }), { status: 200 })
    );
    const client = createLibreNmsClient(config, logger, fetchMock as unknown as typeof fetch);
    const page = await client.listDeviceInterfaces('1', { page: 1, perPage: 100 });
    expect(page.items).toHaveLength(2);
    expect(page.total).toBe(2);
  });

  it('still maps a genuine 5xx on the ports endpoint to UPSTREAM_ERROR (FR-43)', async () => {
    const fetchMock = vi.fn(
      async () => new Response('internal boom', { status: 500 })
    );
    const client = createLibreNmsClient(config, logger, fetchMock as unknown as typeof fetch);
    await expect(client.listDeviceInterfaces('7', { page: 1, perPage: 100 })).rejects.toMatchObject({
      code: 'UPSTREAM_ERROR',
      status: 502
    });
  });

  it('maps a network failure on the ports endpoint to UPSTREAM_UNAVAILABLE (FR-43)', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    const client = createLibreNmsClient(config, logger, fetchMock as unknown as typeof fetch);
    await expect(client.listDeviceInterfaces('7', { page: 1, perPage: 100 })).rejects.toMatchObject({
      code: 'UPSTREAM_UNAVAILABLE',
      status: 503
    });
  });

  it('maps an unrelated 4xx on the ports endpoint to UPSTREAM_ERROR, not empty (FR-43)', async () => {
    // A 403/401 etc. is a real fault, NOT a benign "no ports" — it must NOT be swallowed as empty.
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ status: 'error', message: 'Forbidden' }), { status: 403 })
    );
    const client = createLibreNmsClient(config, logger, fetchMock as unknown as typeof fetch);
    await expect(client.listDeviceInterfaces('7', { page: 1, perPage: 100 })).rejects.toMatchObject({
      code: 'UPSTREAM_ERROR',
      status: 502
    });
  });

  it('checkHealth returns ok on 2xx and error on failure (never throws)', async () => {
    const okFetch = vi.fn(async () => new Response(JSON.stringify({ system: [] }), { status: 200 }));
    const okClient = createLibreNmsClient(config, logger, okFetch as unknown as typeof fetch);
    await expect(okClient.checkHealth()).resolves.toMatchObject({ status: 'ok' });

    const downFetch = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    const downClient = createLibreNmsClient(config, logger, downFetch as unknown as typeof fetch);
    await expect(downClient.checkHealth()).resolves.toMatchObject({
      status: 'error',
      error: 'UPSTREAM_UNAVAILABLE'
    });
  });

  it('ensureUser is a documented no-op (FR-16 deferred) — it must NOT throw on every login', async () => {
    // FR-16 provisioning is formally deferred to Task 7; LibreNMS auto-provisions via `sso` on
    // first login. ensureUser must resolve quietly (not throw) so the login path emits no per-login
    // warn/error for a call that can never succeed in this milestone, and never calls fetch.
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    const client = createLibreNmsClient(config, logger, fetchMock as unknown as typeof fetch);
    await expect(client.ensureUser('alice', 10)).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
