/**
 * Session cookie handling (ADR 0003 §Decision, FR-12, AC-A#2, NFR-12).
 *
 * SECURITY FLOOR: the cookie carries ONLY the opaque session id — a random lookup key. No token
 * (OIDC access/refresh/id), no session secret, and no user PII is ever placed in the cookie. The
 * tokens map to the session record SERVER-SIDE in Redis (`sessionStore.ts`).
 *
 * Flags (ADR 0003): `HttpOnly` (unreadable to JS, so an XSS cannot exfiltrate the id), `Secure`
 * (never sent over plaintext), `SameSite=Lax` (blocks cross-site POST while permitting the OIDC
 * top-level redirect back to `/auth/callback`; `Strict` would strip that GET and break the flow),
 * `Path=/`, host-only (no `Domain` attribute).
 */

export interface SessionCookieOptions {
  /** Cookie lifetime in seconds; should track the session's absolute lifetime. */
  readonly maxAgeSeconds: number;
}

function baseFlags(): string {
  // SameSite=Lax is required for the OIDC callback (a cross-site top-level GET). See module doc.
  return 'Path=/; HttpOnly; Secure; SameSite=Lax';
}

/**
 * Serialize a Set-Cookie value carrying ONLY the opaque id. `value` MUST be the opaque session id
 * produced by `SessionStore.create` — never a token or any identity value.
 */
export function serializeSessionCookie(
  name: string,
  opaqueId: string,
  opts: SessionCookieOptions
): string {
  return `${name}=${opaqueId}; ${baseFlags()}; Max-Age=${Math.max(0, Math.floor(opts.maxAgeSeconds))}`;
}

/** Serialize a Set-Cookie value that clears the session cookie immediately (logout, FR-18). */
export function clearSessionCookie(name: string): string {
  return `${name}=; ${baseFlags()}; Max-Age=0`;
}

/**
 * Read the opaque session id out of a `Cookie` request header, or `null` when absent.
 *
 * A minimal parser (no dependency): splits on `;`, matches the named cookie, and returns its raw
 * value. Only the FIRST occurrence is honoured so a duplicate injected cookie cannot shadow it.
 */
export function readSessionId(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (key === name) {
      const value = part.slice(eq + 1).trim();
      return value.length > 0 ? value : null;
    }
  }
  return null;
}
