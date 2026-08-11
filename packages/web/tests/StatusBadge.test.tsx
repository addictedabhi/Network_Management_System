import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBadge } from '../src/components/StatusBadge';

describe('StatusBadge (NFR-30 — never colour-only)', () => {
  it('renders a text label for every state', () => {
    const { rerender } = render(<StatusBadge state="up" />);
    expect(screen.getByText('Up')).toBeInTheDocument();
    rerender(<StatusBadge state="down" />);
    expect(screen.getByText('Down')).toBeInTheDocument();
    rerender(<StatusBadge state="flapping" />);
    expect(screen.getByText('Flapping')).toBeInTheDocument();
    rerender(<StatusBadge state="unknown" />);
    expect(screen.getByText('Unknown')).toBeInTheDocument();
  });

  it('carries an accessible label and an aria-hidden glyph (icon + text)', () => {
    const { container } = render(<StatusBadge state="up" />);
    expect(screen.getByLabelText('Up')).toBeInTheDocument();
    // The glyph is decorative and hidden from assistive tech; the label does the semantic work.
    expect(container.querySelector('.status-badge__glyph')?.getAttribute('aria-hidden')).toBe('true');
  });
});
