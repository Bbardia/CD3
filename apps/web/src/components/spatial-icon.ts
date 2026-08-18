import type { ViewNode3D } from '@cd3/layout';

/** Prop vocabulary shared by the 3D models, the 2D glyphs, and the palette. */
export type SpatialModelKey =
  | 'analytics'
  | 'browser'
  | 'cloud'
  | 'component'
  | 'database'
  | 'gateway'
  | 'lock'
  | 'mobile'
  | 'person'
  | 'queue'
  | 'server'
  | 'storage'
  | 'system'
  | 'worker';

export const spatialModelKeys: readonly SpatialModelKey[] = [
  'analytics',
  'browser',
  'cloud',
  'component',
  'database',
  'gateway',
  'lock',
  'mobile',
  'person',
  'queue',
  'server',
  'storage',
  'system',
  'worker',
];

export const ICON_LABELS: Readonly<Record<SpatialModelKey, string>> = {
  analytics: 'Analytics',
  browser: 'Web app',
  cloud: 'Cloud',
  component: 'Component',
  database: 'Database',
  gateway: 'API gateway',
  lock: 'Auth',
  mobile: 'Mobile app',
  person: 'Person',
  queue: 'Event stream',
  server: 'Service',
  storage: 'Object storage',
  system: 'System',
  worker: 'Worker',
};

export function isSpatialModelKey(value: string): value is SpatialModelKey {
  return (spatialModelKeys as readonly string[]).includes(value);
}

export type ModelNode = Pick<ViewNode3D, 'kind' | 'tags'> & {
  readonly technology?: string | undefined;
  readonly icon?: string | undefined;
};

const KEYWORD_MODELS: readonly (readonly [RegExp, SpatialModelKey])[] = [
  [/analytics|metrics|telemetry|reporting|dashboard/, 'analytics'],
  [/auth|identity|iam|sso|oauth|security|secrets/, 'lock'],
  [/mobile|ios|android/, 'mobile'],
  [/bucket|blob|object storage|s3\b|storage/, 'storage'],
  [/database|postgre|mysql|sql|mongo|redis|dynamo|data store/, 'database'],
  [/messaging|queue|stream|event|kafka|nats|rabbit|pubsub|bus/, 'queue'],
  [/web|browser|frontend|spa|react|angular|vue|console|ui/, 'browser'],
  [/api|gateway|edge|proxy|ingress|router/, 'gateway'],
  [/worker|job|batch|cron|scheduler|pipeline/, 'worker'],
];

/**
 * Chooses a prop for an element: an explicit icon choice wins, then tags and technology, then the
 * C4 kind. An external system without a choice stays a black-box cloud.
 */
export function modelKeyFor(node: ModelNode): SpatialModelKey {
  if (node.icon !== undefined && isSpatialModelKey(node.icon)) {
    return node.icon;
  }
  if (node.kind === 'person') {
    return 'person';
  }
  if (node.kind === 'softwareSystem' && node.tags.includes('external')) {
    return 'cloud';
  }
  const haystack = `${node.tags.join(' ')} ${node.technology ?? ''}`.toLowerCase();
  const keyword = KEYWORD_MODELS.find(([pattern]) => pattern.test(haystack));
  if (keyword !== undefined) {
    return keyword[1];
  }
  if (node.kind === 'softwareSystem') {
    return 'system';
  }
  return node.kind === 'component' ? 'component' : 'server';
}
