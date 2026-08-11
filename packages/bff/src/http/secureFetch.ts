/**
 * A minimal `fetch`-compatible HTTP client built on `node:https`/`node:http` (no new dependency).
 *
 * Its sole reason to exist is the POC self-signed-certificate concession (team-config §8
 * guardrail 6; plan Task 0.6 note at line ~253): the deployed gateway on `10.121.77.206:8443`
 * presents a self-signed certificate that the system trust store does not recognise.
 *
 * The chosen mechanism is NARROW and fail-safe:
 *   - When an operator supplies the POC CA certificate (`POC_TLS_CA_CERT`), it is added to the
 *     trust store of THIS client instance only, via `https` `ca`. TLS verification stays ON
 *     (`rejectUnauthorized` is never set to false); we simply teach this one client to trust the
 *     POC CA in addition to the system roots.
 *   - When no CA is supplied, the system trust store is used unchanged.
 *
 * What it deliberately does NOT do: it never sets `NODE_TLS_REJECT_UNAUTHORIZED`, never mutates
 * any process-global TLS state, and never disables certificate validation. A misconfigured or
 * wrong CA therefore fails CLOSED (the TLS handshake rejects) rather than silently trusting
 * everything — the opposite of a blanket `rejectUnauthorized: false`.
 *
 * Only the subset of the `fetch`/`Response` surface the LibreNMS client and InfluxMetricsReader
 * use is implemented: request method/headers/body/signal, and a response exposing `ok`, `status`,
 * `text()` and `json()`.
 */
import { request as httpsRequest, type RequestOptions } from 'node:https';
import { request as httpRequest } from 'node:http';
import { Buffer } from 'node:buffer';

export interface SecureFetchOptions {
  /** POC CA certificate (PEM). When present it is trusted IN ADDITION to system roots. */
  readonly caCert?: string | undefined;
}

/**
 * Builds a `fetch`-compatible function. The returned function honours `AbortSignal` (so the
 * callers' per-request timeouts work) and applies the configured CA to HTTPS requests only.
 */
export function createSecureFetch(options: SecureFetchOptions = {}): typeof fetch {
  const ca = options.caCert;

  const secureFetch = (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    const isHttps = url.protocol === 'https:';
    const requestFn = isHttps ? httpsRequest : httpRequest;

    const headers: Record<string, string> = {};
    const initHeaders = init.headers as Record<string, string> | undefined;
    if (initHeaders) for (const [k, v] of Object.entries(initHeaders)) headers[k] = String(v);

    const body =
      typeof init.body === 'string'
        ? init.body
        : init.body === undefined || init.body === null
          ? undefined
          : String(init.body);

    const requestOptions: RequestOptions = {
      method: init.method ?? 'GET',
      headers,
      // CA is applied ONLY on HTTPS and ONLY when supplied. Verification remains enabled.
      ...(isHttps && ca ? { ca } : {})
    };

    return new Promise<Response>((resolve, reject) => {
      const signal = init.signal ?? undefined;
      if (signal?.aborted) {
        reject(abortError());
        return;
      }

      const req = requestFn(url, requestOptions, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          const status = res.statusCode ?? 0;
          resolve(makeResponse(status, text));
        });
        res.on('error', reject);
      });

      const onAbort = (): void => {
        req.destroy(abortError());
      };
      if (signal) signal.addEventListener('abort', onAbort, { once: true });

      req.on('error', (err) => {
        if (signal) signal.removeEventListener('abort', onAbort);
        reject(err);
      });
      req.on('close', () => {
        if (signal) signal.removeEventListener('abort', onAbort);
      });

      if (body !== undefined) req.write(body);
      req.end();
    });
  };

  return secureFetch as typeof fetch;
}

function abortError(): Error {
  const err = new Error('The operation was aborted');
  err.name = 'AbortError';
  return err;
}

/** A tiny `Response`-shaped object exposing only what the callers use. */
function makeResponse(status: number, text: string): Response {
  const partial = {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return text;
    },
    async json() {
      return JSON.parse(text) as unknown;
    }
  };
  return partial as unknown as Response;
}
