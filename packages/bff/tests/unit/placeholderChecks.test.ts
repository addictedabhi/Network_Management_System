import { describe, it, expect } from 'vitest';
import { placeholderHealthChecks } from '../../src/http/routes/placeholderChecks.js';

/**
 * Finding 13 / M-3 / NFR-22: the shipped binary wired four hardcoded `{ status: 'ok' }`
 * placeholders into `/ready`, so it advertised dependency-aware readiness while being
 * STRUCTURALLY INCAPABLE of reporting unhealthy. Same defect class as the fail-open lint
 * guard: a control that cannot fail is worse than no control, because it is trusted.
 *
 * Until real probes land (Tasks 4 and 5), these must fail CLOSED.
 */
describe('placeholder health checks fail closed (finding 13)', () => {
  const names = ['redis', 'librenms', 'idp', 'tsdb'] as const;

  it.each(names)('%s reports error, never a fabricated ok', async (name) => {
    const result = await placeholderHealthChecks[name]();
    expect(result.status).toBe('error');
  });

  it.each(names)('%s reports a machine-readable NOT_IMPLEMENTED-class code for %s', async (name) => {
    const result = await placeholderHealthChecks[name]();
    expect(result.error).toBe('UPSTREAM_UNAVAILABLE');
  });

  it.each(names)('%s does not fabricate a latency for a call never made', async (name) => {
    // `latencyMs: 0` on a probe that never executed is fabricated data (NFR-22).
    expect(await placeholderHealthChecks[name]()).not.toHaveProperty('latencyMs');
  });

  it('exposes exactly the four dependency probes the readiness contract expects', () => {
    expect(Object.keys(placeholderHealthChecks).sort()).toEqual([...names].sort());
  });
});
