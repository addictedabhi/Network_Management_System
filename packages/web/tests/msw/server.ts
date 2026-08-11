/**
 * MSW mock of the BFF at the HTTP boundary — the correct seam for component tests (never mock the
 * bffClient module itself). Handlers model the deployed shape: 4 sim devices, and the withheld
 * AF60 (device 4) returning an `unavailable` RSSI while its SNR is available.
 */
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';

const DEVICES = [
  {
    id: '1',
    hostname: 'sim-switch',
    displayName: 'sim-switch',
    kind: 'switch',
    location: 'lab',
    reachability: 'up',
    uptimeSeconds: { status: 'available', value: 123456, timestamp: '2026-08-10T00:00:00Z' }
  },
  {
    id: '2',
    hostname: 'sim-router',
    displayName: 'sim-router',
    kind: 'router',
    location: 'lab',
    reachability: 'up',
    uptimeSeconds: { status: 'available', value: 98765, timestamp: '2026-08-10T00:00:00Z' }
  },
  {
    id: '3',
    hostname: 'sim-af60',
    displayName: 'AF60 radio',
    kind: 'p2p',
    location: 'roof',
    reachability: 'up',
    uptimeSeconds: { status: 'available', value: 4242, timestamp: '2026-08-10T00:00:00Z' }
  },
  {
    id: '4',
    hostname: 'sim-af60-withheld',
    displayName: 'AF60 (RSSI withheld)',
    kind: 'p2p',
    location: 'roof',
    reachability: 'up',
    uptimeSeconds: { status: 'available', value: 4243, timestamp: '2026-08-10T00:00:00Z' }
  }
];

export const bffHandlers = [
  http.get('/bff/api/v1/session', () =>
    HttpResponse.json({
      success: true,
      data: {
        username: 'alice',
        displayName: 'Alice Operator',
        role: 'engineer',
        canAcknowledge: true,
        canOpenAdminPortal: true
      }
    })
  ),

  http.get('/bff/api/v1/devices', () =>
    HttpResponse.json({
      success: true,
      data: DEVICES,
      meta: { page: 1, perPage: 100, total: DEVICES.length, hasNext: false }
    })
  ),

  http.get('/bff/api/v1/devices/:id/metrics/latest', ({ params, request }) => {
    const url = new URL(request.url);
    const metric = url.searchParams.get('metric');
    const id = params.id as string;

    // The withheld AF60 (device 4): RSSI is UNAVAILABLE — never a fabricated 0.
    if (metric === 'af60StaRSSI' && id === '4') {
      return HttpResponse.json({
        success: true,
        data: { status: 'unavailable', reason: 'OID_NOT_SUPPORTED' }
      });
    }
    if (metric === 'af60StaRSSI') {
      return HttpResponse.json({
        success: true,
        data: { status: 'available', value: -58, timestamp: '2026-08-10T00:00:00Z' }
      });
    }
    if (metric === 'af60StaSNR') {
      return HttpResponse.json({
        success: true,
        data: { status: 'available', value: 31, timestamp: '2026-08-10T00:00:00Z' }
      });
    }
    return HttpResponse.json({
      success: true,
      data: { status: 'available', value: 1000000, timestamp: '2026-08-10T00:00:00Z' }
    });
  }),

  // Time-series: device 1 (switch) has real points; everything else is an honest empty series.
  http.get('/bff/api/v1/devices/:id/metrics/series', ({ params, request }) => {
    const url = new URL(request.url);
    const metric = url.searchParams.get('metric')!;
    const id = params.id as string;
    if (id === '1' && (metric === 'ifInOctets_rate' || metric === 'ifOutOctets_rate')) {
      return HttpResponse.json({
        success: true,
        data: {
          metric,
          deviceId: id,
          points: [
            { timestamp: '2026-08-11T00:00:00Z', value: { status: 'available', value: 100, timestamp: '2026-08-11T00:00:00Z' } },
            { timestamp: '2026-08-11T00:05:00Z', value: { status: 'available', value: 220, timestamp: '2026-08-11T00:05:00Z' } }
          ]
        }
      });
    }
    return HttpResponse.json({ success: true, data: { metric, deviceId: id, points: [] } });
  }),

  // Alarms: the 2 REAL alarms that fired on the enriched stack (never fabricated rows).
  http.get('/bff/api/v1/alarms', ({ request }) => {
    const url = new URL(request.url);
    const severity = url.searchParams.get('severity');
    const all = [
      {
        id: '1',
        deviceId: '2',
        deviceHostname: '172.16.10.22',
        deviceKind: 'other',
        entity: null,
        severity: 'critical',
        ruleName: 'NMS: Device down',
        firstRaisedAt: '2026-08-11T00:00:00Z',
        durationSeconds: 600,
        acknowledged: false,
        acknowledgedBy: null,
        acknowledgedAt: null
      },
      {
        id: '2',
        deviceId: '2',
        deviceHostname: 'sim-router-01',
        deviceKind: 'router',
        entity: 'CPU',
        severity: 'warning',
        ruleName: 'NMS: High CPU utilisation',
        firstRaisedAt: '2026-08-11T00:02:00Z',
        durationSeconds: 480,
        acknowledged: false,
        acknowledgedBy: null,
        acknowledgedAt: null
      }
    ];
    const filtered = severity ? all.filter((a) => a.severity === severity) : all;
    return HttpResponse.json({
      success: true,
      data: filtered,
      meta: { page: 1, perPage: 50, total: filtered.length, hasNext: false }
    });
  }),

  http.post('/bff/api/v1/alarms/:id/ack', ({ params }) =>
    HttpResponse.json({ success: true, data: { id: params.id, acknowledged: true } })
  ),

  http.get('/bff/api/v1/admin-portal-url', () =>
    HttpResponse.json({ success: true, data: { url: 'https://10.121.77.206:8443/device/1' } })
  )
];

export const server = setupServer(...bffHandlers);
