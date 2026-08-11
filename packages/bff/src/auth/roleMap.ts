/**
 * IdP group → platform role and platform role → LibreNMS level mapping (FR-15, ADR 0003).
 *
 * FAIL-CLOSED is the whole point: a set of groups that matches no configured entry resolves to
 * `null`, which the callback turns into a 403 — an unmapped identity is DENIED, never defaulted
 * to any level of access (ADR 0003; the arch-reference `default_level=1` mistake is explicitly
 * NOT copied).
 *
 * The LibreNMS level values are the FINAL ones the human closed under OQ-7 (team memory
 * 2026-08-09; ADR 0003 OQ-7 note): admin=10, engineer=10, operator=1, readonly=5. These SUPERSEDE
 * the plan's proposal (engineer=1, readonly=1), which was written while OQ-7 was still open.
 */
import type { PlatformRole } from '@nms/shared';

/** Highest privilege first. When several groups match, the highest-privilege role wins. */
const PRECEDENCE: readonly PlatformRole[] = ['admin', 'engineer', 'operator', 'readonly'];
const VALID = new Set<string>(PRECEDENCE);

export function mapGroupsToRole(
  groups: readonly string[],
  roleMap: Readonly<Record<string, string>>
): PlatformRole | null {
  const matched = groups
    .map((g) => roleMap[g])
    .filter((r): r is PlatformRole => typeof r === 'string' && VALID.has(r));
  if (matched.length === 0) return null; // Fail closed (ADR 0003).
  for (const role of PRECEDENCE) if (matched.includes(role)) return role;
  return null;
}

/**
 * Platform role → LibreNMS native-UI level (OQ-7 CLOSED — team memory 2026-08-09).
 * admin=10, engineer=10 (full native access), operator=1 (normal user), readonly=5 (global-read).
 */
export function roleToLibreNmsLevel(role: PlatformRole): number {
  switch (role) {
    case 'admin':
    case 'engineer':
      return 10;
    case 'readonly':
      return 5;
    case 'operator':
    default:
      return 1;
  }
}

/** Acknowledge capability (FR-33/34). `readonly` may not acknowledge; everyone else may. */
export function canAcknowledge(role: PlatformRole): boolean {
  return role !== 'readonly';
}

/** "Open Admin Portal" visibility (FR-42, OQ-7). admin + engineer only. */
export function canOpenAdminPortal(role: PlatformRole): boolean {
  return role === 'admin' || role === 'engineer';
}
