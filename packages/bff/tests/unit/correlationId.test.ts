import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { correlationId } from '../../src/http/middleware/correlationId.js';
import { PREVALIDATED_UUID } from '../../src/http/middleware/errorHandler.js';

/**
 * DRIFT GUARD — correlation-id generator vs the error handler's fallback validator.
 *
 * `correlationId.ts` generates the id; `errorHandler.ts` re-validates it against
 * `PREVALIDATED_UUID` before concatenating it into the last-resort record and the minimal
 * fallback envelope. The two are coupled, and a mismatch DEGRADES SILENTLY: every fallback
 * `requestId` becomes `"unknown"` with no error and no other test failure, losing traceability
 * exactly when an incident is hardest to diagnose (test run-4, distrust item #4 — 5 of 7
 * plausible generator swaps degrade, and an uppercase-hex UUID degrades today).
 *
 * The guard therefore asserts through the REAL middleware rather than calling the generator
 * directly — asserting on a locally-called `randomUUID()` would keep passing if
 * `correlationId.ts` swapped generators, recreating the same blind spot one level up — and
 * against the SINGLE exported pattern rather than a third copy of the regex.
 */
describe('correlation id / fallback validator drift guard', () => {
  /** Captures `res.locals.correlationId` as the real middleware actually assigns it. */
  async function generatedIds(samples: number): Promise<string[]> {
    const app = express();
    app.use(correlationId);
    app.get('/probe', (_req, res) => {
      res.json({ id: res.locals.correlationId as unknown });
    });

    const ids: string[] = [];
    for (let i = 0; i < samples; i += 1) {
      const response = await request(app).get('/probe').expect(200);
      ids.push(response.body.id as string);
    }
    return ids;
  }

  it('generates ids the error handler fallback will actually carry', async () => {
    const ids = await generatedIds(20);

    for (const id of ids) {
      expect(typeof id).toBe('string');
      // If this fails, the generator changed shape and every fallback requestId is now "unknown".
      expect(id).toMatch(PREVALIDATED_UUID);
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('rejects an uppercase-hex UUID, the drift case closest to the current generator', () => {
    const lowercase = '0f9c1a2b-3d4e-5f60-8a9b-0c1d2e3f4a5b';

    expect(lowercase).toMatch(PREVALIDATED_UUID);
    // Still a valid RFC-4122 id, yet deliberately NOT carried: the pattern is stricter than
    // "is this a UUID". Documented here so the strictness is visible at the generator site too.
    expect(lowercase.toUpperCase()).not.toMatch(PREVALIDATED_UUID);
  });

  it('rejects the other plausible generator shapes that would degrade silently', () => {
    const degrading = [
      '01ARZ3NDEKTSV4RRFFQ69G5FAV', // ULID (Crockford base32)
      'V1StGXR8_Z5jdHi6B-myT', // nanoid
      'req_0f9c1a2b-3d4e-5f60-8a9b-0c1d2e3f4a5b', // prefixed
      '{0f9c1a2b-3d4e-5f60-8a9b-0c1d2e3f4a5b}' // braced
    ];

    for (const candidate of degrading) {
      expect(candidate).not.toMatch(PREVALIDATED_UUID);
    }
  });
});
