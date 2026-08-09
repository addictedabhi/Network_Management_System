export type PlatformRole = 'admin' | 'engineer' | 'operator' | 'readonly';

/**
 * `canAcknowledge` / `canOpenAdminPortal` are PRESENTATION HINTS ONLY (FR-42).
 * The BFF re-derives authorization from the server-side session on every request
 * (NFR-11) and never trusts these flags. Hiding a UI control is never the control.
 */
export interface SessionInfo {
  readonly username: string;
  readonly displayName: string;
  readonly role: PlatformRole;
  readonly canAcknowledge: boolean;
  readonly canOpenAdminPortal: boolean;
}
