'use client';

/**
 * Reachability / link-state badge (NFR-30): an ICON GLYPH + a TEXT LABEL. Colour is decorative
 * only — the state is always conveyed by the glyph and the word, so a colour-blind operator (or a
 * greyscale screenshot) reads the same state. The glyph is `aria-hidden`; the accessible name is
 * carried by the visible text plus an `aria-label` on the badge.
 *
 * `flapping` is a BFF-computed state (≥3 transitions in 5 min, OQ-12), NOT a native LibreNMS field;
 * it is rendered only when the caller passes it. At POC it effectively never fires.
 */
import type { Reachability } from '@nms/shared';

export type BadgeState = Reachability | 'flapping';

const GLYPH: Record<BadgeState, string> = {
  up: '✔', // heavy check
  down: '✖', // heavy cross
  flapping: '∿', // sine wave (pulse)
  unknown: '—' // em dash
};

const LABEL: Record<BadgeState, string> = {
  up: 'Up',
  down: 'Down',
  flapping: 'Flapping',
  unknown: 'Unknown'
};

export interface StatusBadgeProps {
  readonly state: BadgeState;
}

export function StatusBadge({ state }: StatusBadgeProps) {
  const label = LABEL[state];
  return (
    <span className={`status-badge status-badge--${state}`} aria-label={label}>
      <span className="status-badge__glyph" aria-hidden="true">
        {GLYPH[state]}
      </span>
      <span className="status-badge__label">{label}</span>
    </span>
  );
}
