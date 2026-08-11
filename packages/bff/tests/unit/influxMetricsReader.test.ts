import { describe, it, expect, vi } from 'vitest';
import { createInfluxMetricsReader } from '../../src/metrics/influxMetricsReader.js';
import { createLogger } from '../../src/observability/logger.js';

const logger = createLogger({ logLevel: 'error' });
const config = {
  url: 'http://influx.test:8086',
  org: 'nms',
  bucket: 'librenms',
  token: 'influx-secret-token'
};

// InfluxDB v2 annotated-CSV response (the dialect the query API returns).
const CSV_WITH_ROWS = [
  '#datatype,string,long,dateTime:RFC3339,double,string',
  ',result,table,_time,_value,_field',
  ',_result,0,2026-08-10T00:00:00Z,42.5,uptime',
  ',_result,0,2026-08-10T00:05:00Z,43.0,uptime'
].join('\n');

const CSV_EMPTY = '';

describe('InfluxMetricsReader — FR-24 (absent series → `unavailable`, never 0)', () => {
  it('queryLatest returns `unavailable` (not available(0)) when the series is absent', async () => {
    const fetchMock = vi.fn(async () => new Response(CSV_EMPTY, { status: 200 }));
    const reader = createInfluxMetricsReader(config, logger, fetchMock as unknown as typeof fetch);
    const result = await reader.queryLatest({ metric: 'uptime', deviceId: '1' });
    expect(result.value.status).toBe('unavailable');
    expect((result.value as { value?: number }).value).toBeUndefined();
  });

  it('queryLatest returns `unavailable` (not 0) when InfluxDB is unreachable', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    const reader = createInfluxMetricsReader(config, logger, fetchMock as unknown as typeof fetch);
    const result = await reader.queryLatest({ metric: 'uptime', deviceId: '1' });
    expect(result.value).toMatchObject({ status: 'unavailable', reason: 'UPSTREAM_UNAVAILABLE' });
  });

  it('queryLatest returns `unavailable` (not 0) on a non-2xx response', async () => {
    const fetchMock = vi.fn(async () => new Response('server error', { status: 500 }));
    const reader = createInfluxMetricsReader(config, logger, fetchMock as unknown as typeof fetch);
    const result = await reader.queryLatest({ metric: 'uptime', deviceId: '1' });
    expect(result.value.status).toBe('unavailable');
  });

  it('queryLatest returns the last available point when data exists', async () => {
    const fetchMock = vi.fn(async () => new Response(CSV_WITH_ROWS, { status: 200 }));
    const reader = createInfluxMetricsReader(config, logger, fetchMock as unknown as typeof fetch);
    const result = await reader.queryLatest({ metric: 'uptime', deviceId: '1' });
    expect(result.value).toMatchObject({ status: 'available', value: 43.0 });
  });

  it('querySeries returns empty points (never a fabricated 0 line) when absent', async () => {
    const fetchMock = vi.fn(async () => new Response(CSV_EMPTY, { status: 200 }));
    const reader = createInfluxMetricsReader(config, logger, fetchMock as unknown as typeof fetch);
    const result = await reader.querySeries({
      metric: 'uptime',
      deviceId: '1',
      from: '2026-08-10T00:00:00Z',
      to: '2026-08-10T01:00:00Z',
      step: '5m'
    });
    expect(result.points).toHaveLength(0);
  });

  it('querySeries maps present rows to available points', async () => {
    const fetchMock = vi.fn(async () => new Response(CSV_WITH_ROWS, { status: 200 }));
    const reader = createInfluxMetricsReader(config, logger, fetchMock as unknown as typeof fetch);
    const result = await reader.querySeries({
      metric: 'uptime',
      deviceId: '1',
      from: '2026-08-10T00:00:00Z',
      to: '2026-08-10T01:00:00Z',
      step: '5m'
    });
    expect(result.points).toHaveLength(2);
    expect(result.points[0]!.value).toMatchObject({ status: 'available', value: 42.5 });
  });

  it('sends the token in an Authorization: Token header, never in the URL', async () => {
    const fetchMock = vi.fn(async () => new Response(CSV_EMPTY, { status: 200 }));
    const reader = createInfluxMetricsReader(config, logger, fetchMock as unknown as typeof fetch);
    await reader.queryLatest({ metric: 'uptime', deviceId: '1' });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Token influx-secret-token' });
    expect(String(url)).not.toContain('influx-secret-token');
  });

  it('escapes crafted device ids so they cannot break out of the Flux string literal', async () => {
    const fetchMock = vi.fn(async () => new Response(CSV_EMPTY, { status: 200 }));
    const reader = createInfluxMetricsReader(config, logger, fetchMock as unknown as typeof fetch);
    await reader.queryLatest({ metric: 'uptime', deviceId: '1" or true or "' });
    const [, init] = fetchMock.mock.calls[0]!;
    const body = String((init as RequestInit).body);
    // The raw unescaped injection must not appear; the escaped form must.
    expect(body).not.toContain('"1" or true or ""');
    expect(body).toContain('1\\" or true or \\"');
  });

  // --- Real LibreNMS InfluxDB v2 schema alignment (surfaced by live verification) ---
  // LibreNMS does NOT write `_field == af60StaRSSI` tagged by device_id. Wireless metrics land in
  // `_measurement == "wireless-sensor"` with `_field == "sensor"`, identity tag `hostname`, and the
  // metric distinguished by `sensor_descr` ("Local RSSI" / "Local SNR"). Interface throughput lands
  // in `_measurement == "ports"` with `_field == "INOCTETS"/"OUTOCTETS"`, identity `hostname` +
  // `ifName`. The reader translates the domain metric name to the real selector.
  it('af60StaRSSI resolves to wireless-sensor / Local RSSI keyed by hostname', async () => {
    const fetchMock = vi.fn(async () => new Response(CSV_EMPTY, { status: 200 }));
    const reader = createInfluxMetricsReader(config, logger, fetchMock as unknown as typeof fetch);
    await reader.queryLatest({ metric: 'af60StaRSSI', deviceId: '5', hostname: 'sim-radio-01' });
    const body = String((fetchMock.mock.calls[0]![1] as RequestInit).body);
    expect(body).toContain('_measurement"] == "wireless-sensor"');
    expect(body).toContain('sensor_descr"] == "Local RSSI"');
    expect(body).toContain('hostname"] == "sim-radio-01"');
    // It must NOT use the raw domain name as a _field, nor key by device_id for this metric.
    expect(body).not.toContain('_field"] == "af60StaRSSI"');
  });

  it('af60StaSNR resolves to wireless-sensor / Local SNR', async () => {
    const fetchMock = vi.fn(async () => new Response(CSV_EMPTY, { status: 200 }));
    const reader = createInfluxMetricsReader(config, logger, fetchMock as unknown as typeof fetch);
    await reader.queryLatest({ metric: 'af60StaSNR', deviceId: '5', hostname: 'sim-radio-01' });
    const body = String((fetchMock.mock.calls[0]![1] as RequestInit).body);
    expect(body).toContain('sensor_descr"] == "Local SNR"');
    expect(body).toContain('hostname"] == "sim-radio-01"');
  });

  it('ifInOctets_rate resolves to ports / INOCTETS as a per-second rate keyed by hostname', async () => {
    const fetchMock = vi.fn(async () => new Response(CSV_EMPTY, { status: 200 }));
    const reader = createInfluxMetricsReader(config, logger, fetchMock as unknown as typeof fetch);
    await reader.queryLatest({ metric: 'ifInOctets_rate', deviceId: '3', hostname: 'sim-switch-01' });
    const body = String((fetchMock.mock.calls[0]![1] as RequestInit).body);
    expect(body).toContain('_measurement"] == "ports"');
    expect(body).toContain('_field"] == "INOCTETS"');
    expect(body).toContain('hostname"] == "sim-switch-01"');
    // A counter → rate: the query derives per-second change.
    expect(body).toContain('derivative');
  });

  it('withheld metric (no rows) still maps to `unavailable`, never 0 — against the real schema', async () => {
    // sim-radio-02 has NO "Local RSSI" row in InfluxDB → the query returns no rows.
    const fetchMock = vi.fn(async () => new Response(CSV_EMPTY, { status: 200 }));
    const reader = createInfluxMetricsReader(config, logger, fetchMock as unknown as typeof fetch);
    const result = await reader.queryLatest({
      metric: 'af60StaRSSI',
      deviceId: '6',
      hostname: 'sim-radio-02'
    });
    expect(result.value.status).toBe('unavailable');
    expect((result.value as { value?: number }).value).toBeUndefined();
  });

  it('escapes a crafted hostname so it cannot break out of the Flux string literal', async () => {
    const fetchMock = vi.fn(async () => new Response(CSV_EMPTY, { status: 200 }));
    const reader = createInfluxMetricsReader(config, logger, fetchMock as unknown as typeof fetch);
    await reader.queryLatest({ metric: 'af60StaSNR', deviceId: '5', hostname: 'h" or true or "' });
    const body = String((fetchMock.mock.calls[0]![1] as RequestInit).body);
    expect(body).toContain('h\\" or true or \\"');
    expect(body).not.toContain('"h" or true or ""');
  });

  // --- CPU / memory / mod-rate registry (confirmed against the live store 2026-08-11) ---
  // CPU lands in `_measurement == "processors"`, `_field == "usage"`, identity tag `hostname`.
  // Memory lands in `_measurement == "mempool"`, `_field == "used"`/"free", tag `hostname`.
  // AF60 modulation/link rate lands in `_measurement == "wireless-sensor"`, `_field == "sensor"`,
  // `sensor_descr == "Tx Capacity"`/"Rx Capacity", tag `hostname`.
  it('cpuUsage resolves to processors / usage keyed by hostname', async () => {
    const fetchMock = vi.fn(async () => new Response(CSV_EMPTY, { status: 200 }));
    const reader = createInfluxMetricsReader(config, logger, fetchMock as unknown as typeof fetch);
    await reader.queryLatest({ metric: 'cpuUsage', deviceId: '3', hostname: 'sim-switch-01' });
    const body = String((fetchMock.mock.calls[0]![1] as RequestInit).body);
    expect(body).toContain('_measurement"] == "processors"');
    expect(body).toContain('_field"] == "usage"');
    expect(body).toContain('hostname"] == "sim-switch-01"');
    expect(body).not.toContain('_field"] == "cpuUsage"');
    expect(body).not.toContain('device_id"] == "3"');
  });

  it('memUsedBytes resolves to mempool / used keyed by hostname', async () => {
    const fetchMock = vi.fn(async () => new Response(CSV_EMPTY, { status: 200 }));
    const reader = createInfluxMetricsReader(config, logger, fetchMock as unknown as typeof fetch);
    await reader.queryLatest({ metric: 'memUsedBytes', deviceId: '4', hostname: 'sim-router-01' });
    const body = String((fetchMock.mock.calls[0]![1] as RequestInit).body);
    expect(body).toContain('_measurement"] == "mempool"');
    expect(body).toContain('_field"] == "used"');
    expect(body).toContain('hostname"] == "sim-router-01"');
  });

  it('memFreeBytes resolves to mempool / free keyed by hostname', async () => {
    const fetchMock = vi.fn(async () => new Response(CSV_EMPTY, { status: 200 }));
    const reader = createInfluxMetricsReader(config, logger, fetchMock as unknown as typeof fetch);
    await reader.queryLatest({ metric: 'memFreeBytes', deviceId: '4', hostname: 'sim-router-01' });
    const body = String((fetchMock.mock.calls[0]![1] as RequestInit).body);
    expect(body).toContain('_measurement"] == "mempool"');
    expect(body).toContain('_field"] == "free"');
  });

  it('af60TxCapacity resolves to wireless-sensor / Tx Capacity keyed by hostname', async () => {
    const fetchMock = vi.fn(async () => new Response(CSV_EMPTY, { status: 200 }));
    const reader = createInfluxMetricsReader(config, logger, fetchMock as unknown as typeof fetch);
    await reader.queryLatest({ metric: 'af60TxCapacity', deviceId: '5', hostname: 'sim-radio-01' });
    const body = String((fetchMock.mock.calls[0]![1] as RequestInit).body);
    expect(body).toContain('_measurement"] == "wireless-sensor"');
    expect(body).toContain('sensor_descr"] == "Tx Capacity"');
    expect(body).toContain('hostname"] == "sim-radio-01"');
  });

  it('an unregistered metric falls back to the legacy _field/device_id predicate', async () => {
    const fetchMock = vi.fn(async () => new Response(CSV_EMPTY, { status: 200 }));
    const reader = createInfluxMetricsReader(config, logger, fetchMock as unknown as typeof fetch);
    await reader.queryLatest({ metric: 'uptime', deviceId: '1' });
    const body = String((fetchMock.mock.calls[0]![1] as RequestInit).body);
    expect(body).toContain('_field"] == "uptime"');
    expect(body).toContain('device_id"] == "1"');
  });

  it('checkHealth returns ok on 2xx /health and error otherwise (never throws)', async () => {
    const okFetch = vi.fn(async () => new Response(JSON.stringify({ status: 'pass' }), { status: 200 }));
    const okReader = createInfluxMetricsReader(config, logger, okFetch as unknown as typeof fetch);
    await expect(okReader.checkHealth()).resolves.toMatchObject({ status: 'ok' });

    const downFetch = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    const downReader = createInfluxMetricsReader(config, logger, downFetch as unknown as typeof fetch);
    await expect(downReader.checkHealth()).resolves.toMatchObject({
      status: 'error',
      error: 'UPSTREAM_UNAVAILABLE'
    });
  });
});
