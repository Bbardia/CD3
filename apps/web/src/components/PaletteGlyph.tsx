import type { ReactNode } from 'react';

import type { SpatialModelKey } from './spatial-icon';

/** Simple 16-viewBox line icons, one per model key, drawn with currentColor strokes. */
const GLYPH_PATHS: Readonly<Record<SpatialModelKey, ReactNode>> = {
  analytics: <path d="M3.8 13.2V8.6M8 13.2V3.6M12.2 13.2V6.4" />,
  browser: (
    <>
      <rect x="2" y="2.8" width="12" height="10.4" rx="1.4" />
      <path d="M2 6h12M4.3 4.4h.01" />
    </>
  ),
  cache: <path d="M8.8 2.2 4.4 8.9h2.8l-.9 4.9 4.4-6.7H7.9z" />,
  cloud: <path d="M5 12.5h6.2a3 3 0 0 0 .6-5.9 4.2 4.2 0 0 0-8.2-1A2.9 2.9 0 0 0 5 12.5z" />,
  component: (
    <>
      <rect x="2.8" y="6.2" width="10.4" height="7" rx="1" />
      <path d="M4.6 6.2V3.6h2.8v2.6M8.6 6.2V3.6h2.8v2.6" />
    </>
  ),
  database: (
    <>
      <ellipse cx="8" cy="3.8" rx="5.2" ry="1.9" />
      <path d="M2.8 3.8v8.4c0 1 2.3 1.9 5.2 1.9s5.2-.9 5.2-1.9V3.8M2.8 8c0 1 2.3 1.9 5.2 1.9S13.2 9 13.2 8" />
    </>
  ),
  docs: (
    <>
      <path d="M4 1.8h4.8L12 5v9.2H4z" />
      <path d="M8.8 1.8V5H12M6 8.4h4M6 10.8h4" />
    </>
  ),
  firewall: (
    <>
      <rect x="2" y="3.5" width="12" height="9" rx="0.8" />
      <path d="M2 6.5h12M2 9.5h12M8 3.5v3M5.3 6.5v3M10.7 6.5v3M8 9.5v3" />
    </>
  ),
  gateway: <path d="M5.2 5 2.5 8l2.7 3M10.8 5l2.7 3-2.7 3M9.2 3.5l-2.4 9" />,
  lock: (
    <>
      <rect x="3.8" y="7" width="8.4" height="6.2" rx="1.2" />
      <path d="M5.6 7V5.2a2.4 2.4 0 0 1 4.8 0V7" />
    </>
  ),
  mobile: (
    <>
      <rect x="4.8" y="1.8" width="6.4" height="12.4" rx="1.6" />
      <path d="M7 12h2" />
    </>
  ),
  person: (
    <>
      <circle cx="8" cy="5.2" r="2.6" />
      <path d="M3.2 13.6a4.9 4.9 0 0 1 9.6 0" />
    </>
  ),
  queue: <path d="M4.2 4.5 7.7 8l-3.5 3.5M8.8 4.5 12.3 8l-3.5 3.5" />,
  scheduler: (
    <>
      <circle cx="8" cy="8" r="5.6" />
      <path d="M8 4.8V8l2.3 1.4" />
    </>
  ),
  server: (
    <>
      <rect x="2.5" y="2.8" width="11" height="4.4" rx="1" />
      <rect x="2.5" y="8.8" width="11" height="4.4" rx="1" />
      <path d="M5.2 5h.01M5.2 11h.01" />
    </>
  ),
  storage: (
    <>
      <rect x="2" y="2.8" width="12" height="3.6" rx="0.8" />
      <path d="M3.2 6.4v5.8c0 .7.6 1.2 1.3 1.2h7c.7 0 1.3-.5 1.3-1.2V6.4M6.5 9h3" />
    </>
  ),
  system: (
    <>
      <path d="M8 1.8 13.4 4.9v6.2L8 14.2 2.6 11.1V4.9z" />
      <path d="M2.6 4.9 8 8l5.4-3.1M8 8v6.2" />
    </>
  ),
  worker: (
    <>
      <circle cx="8" cy="8" r="2.4" />
      <path d="M8 2.2v2M8 11.8v2M2.2 8h2M11.8 8h2M3.9 3.9l1.4 1.4M10.7 10.7l1.4 1.4M12.1 3.9l-1.4 1.4M5.3 10.7l-1.4 1.4" />
    </>
  ),
};

/** The palette tile for a model key: its colour swatch with the object's icon drawn on top. */
export function PaletteGlyph({ id }: { readonly id: SpatialModelKey }) {
  return (
    <span className={`palette-glyph palette-glyph--${id}`} aria-hidden="true">
      <svg
        viewBox="0 0 16 16"
        width="14"
        height="14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {GLYPH_PATHS[id]}
      </svg>
    </span>
  );
}
