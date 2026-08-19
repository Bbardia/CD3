import type { ElementInput, ReadonlyProject, ViewType } from '@cd3/domain';

import type { SpatialModelKey } from '../components/spatial-icon';

/** Payload type used by the object palette's HTML drag and drop. */
export const PALETTE_MIME = 'application/x-cd3-palette';

/** Default 2D footprint of a dropped element, matching the sample project's placements. */
export const DEFAULT_PLACEMENT_SIZE = { width: 240, height: 110 } as const;

export interface PaletteEntry {
  readonly id: SpatialModelKey;
  readonly label: string;
  /** Seed technology, which is also what resolves the 3D prop for the new element. */
  readonly technology: string;
  readonly tags: readonly string[];
  /** People are people in every view; everything else takes the view's own kind. */
  readonly forcedKind?: 'person';
}

export const paletteEntries: readonly PaletteEntry[] = [
  { id: 'server', label: 'Service', technology: 'Node.js service', tags: ['service'] },
  { id: 'gateway', label: 'API gateway', technology: 'HTTP API', tags: ['api'] },
  { id: 'database', label: 'Database', technology: 'PostgreSQL', tags: ['database'] },
  { id: 'queue', label: 'Event stream', technology: 'Message broker', tags: ['messaging'] },
  { id: 'browser', label: 'Web app', technology: 'Web frontend', tags: ['web'] },
  { id: 'worker', label: 'Worker', technology: 'Background worker', tags: ['worker'] },
  { id: 'cache', label: 'Cache', technology: 'Redis', tags: ['cache'] },
  { id: 'scheduler', label: 'Scheduler', technology: 'Cron scheduler', tags: ['scheduler'] },
  { id: 'firewall', label: 'Firewall', technology: 'Firewall', tags: ['firewall'] },
  { id: 'storage', label: 'Object storage', technology: 'Object storage', tags: ['storage'] },
  { id: 'analytics', label: 'Analytics', technology: 'Metrics dashboard', tags: ['analytics'] },
  { id: 'lock', label: 'Auth service', technology: 'Identity provider', tags: ['auth'] },
  { id: 'mobile', label: 'Mobile app', technology: 'Mobile client', tags: ['mobile'] },
  { id: 'cloud', label: 'External system', technology: 'External service', tags: ['external'] },
  { id: 'system', label: 'System', technology: 'Software system', tags: ['software-system'] },
  { id: 'component', label: 'Component', technology: 'Application module', tags: ['component'] },
  {
    id: 'person',
    label: 'Person',
    technology: 'Human actor',
    tags: ['person'],
    forcedKind: 'person',
  },
];

export function paletteEntryById(id: string): PaletteEntry | undefined {
  return paletteEntries.find((entry) => entry.id === id);
}

const VIEW_KIND: Readonly<Record<ViewType, 'component' | 'container' | 'softwareSystem'>> = {
  component: 'component',
  container: 'container',
  context: 'softwareSystem',
};

/** Lowercase, URL-safe, and free in this project. */
export function uniqueId(
  project: ReadonlyProject,
  base: string,
  taken: (id: string) => boolean,
): string {
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const stem = slug === '' ? 'element' : slug;
  let candidate = stem;
  let counter = 2;
  while (taken(candidate)) {
    candidate = `${stem}-${String(counter)}`;
    counter += 1;
  }
  return candidate;
}

/**
 * Builds the element a dropped palette entry stands for. The C4 kind comes from the view being
 * authored — a container view holds containers — while the entry decides what the thing *is*.
 */
export function elementFromPalette(
  entry: PaletteEntry,
  project: ReadonlyProject,
  view: { readonly type: ViewType; readonly scopeElementId: string },
  elementId: string,
): ElementInput {
  const kind = entry.forcedKind ?? VIEW_KIND[view.type];
  const shared = {
    id: elementId,
    name: entry.label,
    technology: entry.technology,
    tags: [...entry.tags],
    properties: {},
    externalRefs: [],
  };

  if (kind === 'container' || kind === 'component') {
    // Nested kinds need a parent; the view's scope is the element the view is drawn for.
    const parentId = Object.hasOwn(project.elements, view.scopeElementId)
      ? view.scopeElementId
      : undefined;
    if (parentId !== undefined) {
      return { ...shared, kind, parentId } as ElementInput;
    }
  }
  return { ...shared, kind: kind === 'person' ? 'person' : 'softwareSystem' } as ElementInput;
}
