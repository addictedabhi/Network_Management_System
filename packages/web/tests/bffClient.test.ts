import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { server, bffHandlers } from './msw/server';
import { http, HttpResponse } from 'msw';
import { bffClient, BffError } from '../src/lib/bffClient';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('bffClient — credential handling', () => {
  it('sends credentials (the opaque cookie) and the CSRF header, and NO token', async () => {
    let capturedInit: RequestInit | undefined;
    const realFetch = globalThis.fetch;
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      capturedInit = init;
      return realFetch(input as string, init);
    });

    await bffClient.getSession();

    expect(capturedInit?.credentials).toBe('include');
    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers['x-requested-with']).toBe('nms-ui');
    // The client NEVER sets an Authorization header — no token leaves the browser.
    expect(headers['Authorization']).toBeUndefined();
    expect(headers['authorization']).toBeUndefined();
    spy.mockRestore();
  });

  it('always calls a same-origin /bff path — never a LibreNMS or InfluxDB URL', async () => {
    const seen: string[] = [];
    const realFetch = globalThis.fetch;
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      seen.push(String(input));
      return realFetch(input as string, init);
    });
    await bffClient.listDevices('perPage=10');
    expect(seen[0]).toMatch(/^\/bff\/api\/v1\/devices/);
    expect(seen[0]).not.toMatch(/librenms|influx|10\.121\.77\.206|api\/v0/i);
    spy.mockRestore();
  });

  it('throws a BffError with the machine-readable code on an error envelope', async () => {
    server.use(
      http.get('/bff/api/v1/devices', () =>
        HttpResponse.json(
          { success: false, errors: [{ code: 'UPSTREAM_UNAVAILABLE', message: 'down' }], meta: { requestId: 'x' } },
          { status: 503 }
        )
      )
    );
    await expect(bffClient.listDevices()).rejects.toBeInstanceOf(BffError);
    await expect(bffClient.listDevices()).rejects.toMatchObject({ code: 'UPSTREAM_UNAVAILABLE' });
  });

  void bffHandlers;
});
