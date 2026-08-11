import { describe, it, expect } from 'vitest';
import {
  mapGroupsToRole,
  roleToLibreNmsLevel,
  canAcknowledge,
  canOpenAdminPortal
} from '../../src/auth/roleMap.js';

const map = {
  'nms-admin': 'admin',
  'nms-engineer': 'engineer',
  'nms-operator': 'operator',
  'nms-readonly': 'readonly'
} as const;

describe('mapGroupsToRole', () => {
  it('maps each configured group to its role', () => {
    expect(mapGroupsToRole(['nms-admin'], map)).toBe('admin');
    expect(mapGroupsToRole(['nms-engineer'], map)).toBe('engineer');
    expect(mapGroupsToRole(['nms-operator'], map)).toBe('operator');
    expect(mapGroupsToRole(['nms-readonly'], map)).toBe('readonly');
  });

  it('picks the highest-privilege role when several groups match', () => {
    expect(mapGroupsToRole(['nms-readonly', 'nms-admin'], map)).toBe('admin');
    expect(mapGroupsToRole(['nms-operator', 'nms-engineer'], map)).toBe('engineer');
  });

  it('returns null for an unmapped group — fail closed, never default to readonly', () => {
    expect(mapGroupsToRole(['some-other-group'], map)).toBeNull();
  });

  it('returns null for no groups at all', () => {
    expect(mapGroupsToRole([], map)).toBeNull();
  });

  it('ignores a role map value that is not a valid platform role', () => {
    expect(mapGroupsToRole(['x'], { x: 'superuser' })).toBeNull();
  });
});

describe('roleToLibreNmsLevel (OQ-7 FINAL)', () => {
  it('maps roles to the OQ-7 CLOSED levels', () => {
    expect(roleToLibreNmsLevel('admin')).toBe(10);
    expect(roleToLibreNmsLevel('engineer')).toBe(10);
    expect(roleToLibreNmsLevel('operator')).toBe(1);
    expect(roleToLibreNmsLevel('readonly')).toBe(5);
  });
});

describe('capability helpers', () => {
  it('readonly cannot acknowledge; others can (FR-34)', () => {
    expect(canAcknowledge('readonly')).toBe(false);
    expect(canAcknowledge('operator')).toBe(true);
    expect(canAcknowledge('engineer')).toBe(true);
    expect(canAcknowledge('admin')).toBe(true);
  });

  it('only admin and engineer see the admin portal (FR-42)', () => {
    expect(canOpenAdminPortal('admin')).toBe(true);
    expect(canOpenAdminPortal('engineer')).toBe(true);
    expect(canOpenAdminPortal('operator')).toBe(false);
    expect(canOpenAdminPortal('readonly')).toBe(false);
  });
});
