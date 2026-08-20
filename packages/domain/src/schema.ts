import { z } from 'zod';

export const SCHEMA_VERSION = 1 as const;
export const LIMITS = {
  cameraCoordinate: 100_000,
  description: 2_000,
  elements: 5_000,
  externalReferences: 16,
  id: 96,
  jsonCollectionItems: 256,
  jsonDepth: 8,
  jsonPropertyKeys: 128,
  name: 120,
  placementCoordinate: 1_000_000,
  projectPayload: 5_000_000,
  propertiesPayload: 16_384,
  relationships: 10_000,
  tags: 32,
  tagText: 64,
  technology: 120,
  url: 2_048,
  views: 128,
} as const;

const idPattern = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const IdSchema = z
  .string()
  .min(1)
  .max(LIMITS.id)
  .regex(idPattern, 'IDs must be lowercase, URL-safe identifiers.');

export const ProjectIdSchema = IdSchema.brand<'ProjectId'>();
export const ElementIdSchema = IdSchema.brand<'ElementId'>();
export const RelationshipIdSchema = IdSchema.brand<'RelationshipId'>();
export const ViewIdSchema = IdSchema.brand<'ViewId'>();
export const ViewItemIdSchema = IdSchema.brand<'ViewItemId'>();
export const CameraBookmarkIdSchema = IdSchema.brand<'CameraBookmarkId'>();

const NameSchema = z.string().trim().min(1).max(LIMITS.name);
const DescriptionSchema = z.string().trim().min(1).max(LIMITS.description);
const TechnologySchema = z.string().trim().min(1).max(LIMITS.technology);
const TagSchema = z.string().trim().min(1).max(LIMITS.tagText);
const TagsSchema = z.array(TagSchema).max(LIMITS.tags);

export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export const JsonValueSchema: z.ZodType<JsonValue, JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string().max(LIMITS.description),
    z.array(JsonValueSchema).max(LIMITS.jsonCollectionItems),
    z.record(z.string().min(1).max(LIMITS.tagText), JsonValueSchema),
  ]),
);

function getJsonDepth(value: JsonValue): number {
  if (Array.isArray(value)) {
    return value.length === 0 ? 1 : 1 + Math.max(...value.map(getJsonDepth));
  }
  if (value !== null && typeof value === 'object') {
    const children = Object.values(value);
    return children.length === 0 ? 1 : 1 + Math.max(...children.map(getJsonDepth));
  }
  return 0;
}

export const PropertiesSchema = z
  .record(z.string().min(1).max(LIMITS.tagText), JsonValueSchema)
  .superRefine((properties, context) => {
    if (Object.keys(properties).length > LIMITS.jsonPropertyKeys) {
      context.addIssue({
        code: 'custom',
        message: `Properties may contain at most ${String(LIMITS.jsonPropertyKeys)} keys.`,
      });
    }
    if (JSON.stringify(properties).length > LIMITS.propertiesPayload) {
      context.addIssue({
        code: 'custom',
        message: `Properties payload exceeds ${String(LIMITS.propertiesPayload)} characters.`,
      });
    }
    if (getJsonDepth(properties) > LIMITS.jsonDepth) {
      context.addIssue({
        code: 'custom',
        message: `Properties nesting exceeds ${String(LIMITS.jsonDepth)} levels.`,
      });
    }
  });

export const ExternalReferenceSchema = z
  .object({
    kind: z.enum(['documentation', 'repository', 'dashboard', 'other']),
    label: NameSchema,
    url: z.url().max(LIMITS.url),
  })
  .strict();

const SharedMetadataShape = {
  description: DescriptionSchema.optional(),
  externalRefs: z.array(ExternalReferenceSchema).max(LIMITS.externalReferences),
  name: NameSchema,
  properties: PropertiesSchema,
  tags: TagsSchema,
  technology: TechnologySchema.optional(),
};

const PersonSchema = z
  .object({
    ...SharedMetadataShape,
    id: ElementIdSchema,
    kind: z.literal('person'),
  })
  .strict();

const SoftwareSystemSchema = z
  .object({
    ...SharedMetadataShape,
    id: ElementIdSchema,
    kind: z.literal('softwareSystem'),
  })
  .strict();

const ContainerSchema = z
  .object({
    ...SharedMetadataShape,
    id: ElementIdSchema,
    kind: z.literal('container'),
    parentId: ElementIdSchema,
  })
  .strict();

const ComponentSchema = z
  .object({
    ...SharedMetadataShape,
    id: ElementIdSchema,
    kind: z.literal('component'),
    parentId: ElementIdSchema,
  })
  .strict();

export const ElementSchema = z.discriminatedUnion('kind', [
  PersonSchema,
  SoftwareSystemSchema,
  ContainerSchema,
  ComponentSchema,
]);
export const ElementKindSchema = z.enum(['person', 'softwareSystem', 'container', 'component']);

export const RelationshipSchema = z
  .object({
    description: DescriptionSchema.optional(),
    externalRefs: z.array(ExternalReferenceSchema).max(LIMITS.externalReferences),
    id: RelationshipIdSchema,
    interaction: z.enum(['synchronous', 'asynchronous']),
    name: NameSchema,
    properties: PropertiesSchema,
    sourceId: ElementIdSchema,
    tags: TagsSchema,
    targetId: ElementIdSchema,
    technology: TechnologySchema.optional(),
  })
  .strict();

/** Presentation-layer decoration for one view: boundary boxes and text notes, never semantics. */
export const ViewAnnotationSchema = z
  .object({
    id: IdSchema,
    kind: z.enum(['boundary', 'note']),
    label: NameSchema.optional(),
    color: z
      .string()
      .regex(/^#[0-9a-f]{6}$/i)
      .optional(),
    height: z.number().finite().min(24).max(4_000),
    width: z.number().finite().min(40).max(4_000),
    x: z.number().finite().min(-1_000_000).max(1_000_000),
    y: z.number().finite().min(-1_000_000).max(1_000_000),
  })
  .strict();

const AnnotationRecordSchema = z
  .record(IdSchema, ViewAnnotationSchema)
  .superRefine((annotations, context) => {
    if (Object.keys(annotations).length > 64) {
      context.addIssue({
        code: 'custom',
        message: 'A view may contain at most 64 annotations.',
      });
    }
  });

export const ViewItemSchema = z
  .object({
    elementId: ElementIdSchema,
    id: ViewItemIdSchema,
    label: NameSchema.optional(),
  })
  .strict();

const boundedCoordinate = z
  .number()
  .finite()
  .min(-LIMITS.placementCoordinate)
  .max(LIMITS.placementCoordinate);

export const Placement2DSchema = z
  .object({
    height: z.number().finite().min(24).max(2_000),
    width: z.number().finite().min(40).max(2_000),
    x: boundedCoordinate,
    y: boundedCoordinate,
  })
  .strict();

const ItemRecordSchema = z.record(IdSchema, ViewItemSchema).superRefine((items, context) => {
  if (Object.keys(items).length > LIMITS.elements) {
    context.addIssue({
      code: 'custom',
      message: `A view may contain at most ${String(LIMITS.elements)} items.`,
    });
  }
});

const PlacementRecordSchema = z.record(IdSchema, Placement2DSchema);

export const ViewSchema = z
  .object({
    description: DescriptionSchema.optional(),
    annotations: AnnotationRecordSchema.optional(),
    id: ViewIdSchema,
    items: ItemRecordSchema,
    name: NameSchema,
    placements: PlacementRecordSchema,
    relationshipIds: z.array(RelationshipIdSchema).max(LIMITS.relationships),
    scopeElementId: ElementIdSchema,
    type: z.enum(['context', 'container', 'component']),
  })
  .strict();

const CameraCoordinateSchema = z
  .number()
  .finite()
  .min(-LIMITS.cameraCoordinate)
  .max(LIMITS.cameraCoordinate);

export const Vector3Schema = z
  .object({
    x: CameraCoordinateSchema,
    y: CameraCoordinateSchema,
    z: CameraCoordinateSchema,
  })
  .strict();

export const CameraBookmarkSchema = z
  .object({
    fov: z.number().finite().min(10).max(120).optional(),
    id: CameraBookmarkIdSchema,
    name: NameSchema,
    position: Vector3Schema,
    projection: z.enum(['orthographic', 'perspective']),
    target: Vector3Schema,
    viewId: ViewIdSchema,
    zoom: z.number().finite().min(0.01).max(100).optional(),
  })
  .strict();

export const ThreeDPolicySchema = z
  .object({
    coordinateScale: z.number().finite().min(0.001).max(10),
    defaultProjection: z.enum(['orthographic', 'perspective']),
    elevationStep: z.number().finite().min(0).max(100),
    platformPadding: z.number().finite().min(0).max(500),
  })
  .strict();

function recordWithLimit<Key extends z.ZodType<string>, Value extends z.ZodType>(
  key: Key,
  value: Value,
  maximum: number,
  label: string,
) {
  return z.record(key, value).superRefine((record, context) => {
    if (Object.keys(record).length > maximum) {
      context.addIssue({
        code: 'custom',
        message: `${label} may contain at most ${String(maximum)} records.`,
      });
    }
  });
}

const ProjectStructureSchema = z
  .object({
    description: DescriptionSchema.optional(),
    elements: recordWithLimit(IdSchema, ElementSchema, LIMITS.elements, 'Elements'),
    id: ProjectIdSchema,
    name: NameSchema,
    relationships: recordWithLimit(
      IdSchema,
      RelationshipSchema,
      LIMITS.relationships,
      'Relationships',
    ),
    schemaVersion: z.literal(SCHEMA_VERSION),
    threeD: z
      .object({
        bookmarks: recordWithLimit(
          IdSchema,
          CameraBookmarkSchema,
          LIMITS.views,
          'Camera bookmarks',
        ),
        policy: ThreeDPolicySchema,
      })
      .strict(),
    views: recordWithLimit(IdSchema, ViewSchema, LIMITS.views, 'Views'),
  })
  .strict();

function addIssue(context: z.RefinementCtx, path: PropertyKey[], message: string): void {
  context.addIssue({ code: 'custom', message, path });
}

function validateRecordKeys(
  context: z.RefinementCtx,
  collectionName: 'elements' | 'relationships' | 'views',
  records: Record<string, { id: string }>,
): void {
  for (const [key, record] of Object.entries(records)) {
    if (key !== record.id) {
      addIssue(
        context,
        [collectionName, key, 'id'],
        `Record key "${key}" must match embedded id "${record.id}".`,
      );
    }
  }
}

export const ProjectSchema = ProjectStructureSchema.superRefine((project, context) => {
  const elements: Record<string, z.infer<typeof ElementSchema>> = project.elements;
  const relationships: Record<string, z.infer<typeof RelationshipSchema>> = project.relationships;
  const views: Record<string, z.infer<typeof ViewSchema>> = project.views;

  // The editor, command layer, and every renderer require an active view. Keep that invariant at
  // the document boundary as well, so an API PUT or imported file can never validate successfully
  // and then crash while the workspace chooses its initial view.
  if (Object.keys(views).length === 0) {
    addIssue(context, ['views'], 'A project needs at least one view.');
  }

  validateRecordKeys(context, 'elements', elements);
  validateRecordKeys(context, 'relationships', relationships);
  validateRecordKeys(context, 'views', views);

  for (const [elementKey, element] of Object.entries(elements)) {
    if (!('parentId' in element)) {
      continue;
    }
    const parent = Object.hasOwn(elements, element.parentId)
      ? elements[element.parentId]
      : undefined;
    if (parent === undefined) {
      addIssue(
        context,
        ['elements', elementKey, 'parentId'],
        `Parent element "${element.parentId}" does not exist.`,
      );
      continue;
    }
    const expectedParentKind = element.kind === 'container' ? 'softwareSystem' : 'container';
    if (parent.kind !== expectedParentKind) {
      addIssue(
        context,
        ['elements', elementKey, 'parentId'],
        `${element.kind} elements must have a ${expectedParentKind} parent.`,
      );
    }
  }

  for (const [elementKey] of Object.entries(elements)) {
    const visited = new Set<string>();
    let currentKey: string | undefined = elementKey;
    while (currentKey !== undefined) {
      if (visited.has(currentKey)) {
        addIssue(
          context,
          ['elements', elementKey, 'parentId'],
          'Element parent graph must be acyclic.',
        );
        break;
      }
      visited.add(currentKey);
      const current: z.infer<typeof ElementSchema> | undefined = Object.hasOwn(elements, currentKey)
        ? elements[currentKey]
        : undefined;
      currentKey = current !== undefined && 'parentId' in current ? current.parentId : undefined;
    }
  }

  for (const [relationshipKey, relationship] of Object.entries(relationships)) {
    if (!Object.hasOwn(elements, relationship.sourceId)) {
      addIssue(
        context,
        ['relationships', relationshipKey, 'sourceId'],
        `Source element "${relationship.sourceId}" does not exist.`,
      );
    }
    if (!Object.hasOwn(elements, relationship.targetId)) {
      addIssue(
        context,
        ['relationships', relationshipKey, 'targetId'],
        `Target element "${relationship.targetId}" does not exist.`,
      );
    }
    if (relationship.sourceId === relationship.targetId) {
      addIssue(
        context,
        ['relationships', relationshipKey, 'targetId'],
        'Semantic relationships may not be self-loops.',
      );
    }
  }

  const expectedScopeKinds = {
    component: 'container',
    container: 'softwareSystem',
    context: 'softwareSystem',
  } as const;

  for (const [viewKey, view] of Object.entries(views)) {
    const scope = Object.hasOwn(elements, view.scopeElementId)
      ? elements[view.scopeElementId]
      : undefined;
    if (scope === undefined) {
      addIssue(
        context,
        ['views', viewKey, 'scopeElementId'],
        `View scope "${view.scopeElementId}" does not exist.`,
      );
    } else if (scope.kind !== expectedScopeKinds[view.type]) {
      addIssue(
        context,
        ['views', viewKey, 'scopeElementId'],
        `${view.type} views require a ${expectedScopeKinds[view.type]} scope.`,
      );
    }

    const seenElements = new Set<string>();
    for (const [itemKey, item] of Object.entries(view.items)) {
      if (itemKey !== item.id) {
        addIssue(
          context,
          ['views', viewKey, 'items', itemKey, 'id'],
          `View item key "${itemKey}" must match embedded id "${item.id}".`,
        );
      }
      if (!Object.hasOwn(elements, item.elementId)) {
        addIssue(
          context,
          ['views', viewKey, 'items', itemKey, 'elementId'],
          `View item element "${item.elementId}" does not exist.`,
        );
      }
      if (seenElements.has(item.elementId)) {
        addIssue(
          context,
          ['views', viewKey, 'items', itemKey, 'elementId'],
          `Element "${item.elementId}" may occur only once in an MVP view.`,
        );
      }
      seenElements.add(item.elementId);
      if (!Object.hasOwn(view.placements, itemKey)) {
        addIssue(
          context,
          ['views', viewKey, 'placements', itemKey],
          `View item "${itemKey}" requires a 2D placement.`,
        );
      }
    }

    for (const placementKey of Object.keys(view.placements)) {
      if (!Object.hasOwn(view.items, placementKey)) {
        addIssue(
          context,
          ['views', viewKey, 'placements', placementKey],
          `Placement "${placementKey}" does not reference a view item.`,
        );
      }
    }

    const seenRelationships = new Set<string>();
    for (const [index, relationshipId] of view.relationshipIds.entries()) {
      if (!Object.hasOwn(relationships, relationshipId)) {
        addIssue(
          context,
          ['views', viewKey, 'relationshipIds', index],
          `View relationship "${relationshipId}" does not exist.`,
        );
      }
      if (seenRelationships.has(relationshipId)) {
        addIssue(
          context,
          ['views', viewKey, 'relationshipIds', index],
          `Relationship "${relationshipId}" may occur only once in a view.`,
        );
      }
      seenRelationships.add(relationshipId);
    }
  }

  for (const [bookmarkKey, bookmark] of Object.entries(project.threeD.bookmarks)) {
    if (bookmarkKey !== bookmark.id) {
      addIssue(
        context,
        ['threeD', 'bookmarks', bookmarkKey, 'id'],
        `Camera bookmark key "${bookmarkKey}" must match embedded id "${bookmark.id}".`,
      );
    }
    if (!Object.hasOwn(views, bookmark.viewId)) {
      addIssue(
        context,
        ['threeD', 'bookmarks', bookmarkKey, 'viewId'],
        `Camera bookmark view "${bookmark.viewId}" does not exist.`,
      );
    }
  }

  if (JSON.stringify(project).length > LIMITS.projectPayload) {
    addIssue(context, [], `Project payload exceeds ${String(LIMITS.projectPayload)} characters.`);
  }
});

export type Project = z.output<typeof ProjectSchema>;
export type ProjectInput = z.input<typeof ProjectSchema>;
export type ProjectId = z.output<typeof ProjectIdSchema>;
export type Element = z.output<typeof ElementSchema>;
export type ElementInput = z.input<typeof ElementSchema>;
export type ElementKind = z.output<typeof ElementKindSchema>;
export type Person = Extract<Element, { kind: 'person' }>;
export type SoftwareSystem = Extract<Element, { kind: 'softwareSystem' }>;
export type Container = Extract<Element, { kind: 'container' }>;
export type Component = Extract<Element, { kind: 'component' }>;
export type ExternalReference = z.output<typeof ExternalReferenceSchema>;
export type Relationship = z.output<typeof RelationshipSchema>;
export type RelationshipInput = z.input<typeof RelationshipSchema>;
export type RelationshipInteraction = Relationship['interaction'];
export type View = z.output<typeof ViewSchema>;
export type ViewInput = z.input<typeof ViewSchema>;
export type ViewItem = z.output<typeof ViewItemSchema>;
export type ViewItemInput = z.input<typeof ViewItemSchema>;
export type ViewType = View['type'];
export type Placement2D = z.output<typeof Placement2DSchema>;
export type Placement2DInput = z.input<typeof Placement2DSchema>;
export type ViewAnnotation = z.output<typeof ViewAnnotationSchema>;
export type ThreeDPolicy = z.output<typeof ThreeDPolicySchema>;
export type Vector3 = z.output<typeof Vector3Schema>;
export type CameraBookmark = z.output<typeof CameraBookmarkSchema>;
export type CameraBookmarkInput = z.input<typeof CameraBookmarkSchema>;
export type CameraBookmarkId = z.output<typeof CameraBookmarkIdSchema>;
export type ElementId = z.output<typeof ElementIdSchema>;
export type RelationshipId = z.output<typeof RelationshipIdSchema>;
export type ViewId = z.output<typeof ViewIdSchema>;
export type ViewItemId = z.output<typeof ViewItemIdSchema>;
