import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import type {
  DeepReadonly,
  Element,
  JsonValue,
  ElementChanges,
  ElementId,
  ReadonlyProject,
  Relationship,
  RelationshipChanges,
  ViewAnnotation,
  ViewItemMove,
} from '@cd3/domain';

import { Diagram2D } from './components/Diagram2D';
import { ObjectPalette } from './components/ObjectPalette';
import { WorkspaceMenu } from './components/WorkspaceMenu';
import { StageQuickBar } from './components/StageQuickBar';
import { CommandErrorBanner, EditorToolbar } from './components/EditorToolbar';
import { ElementInspectorForm } from './components/ElementInspectorForm';
import type { CommandErrorData } from './editor/editor-store';
import { useEditorStore, useEditorStoreApi } from './editor/EditorStoreProvider';
import { isTextEntryTarget } from './editor/keyboard';
import { downloadDataUrl, fileStem } from './editor/project-file';
import { embedProjectInPng } from './editor/png-project';
import { ICON_LABELS, spatialModelKeys } from './components/spatial-icon';
import { PaletteGlyph } from './components/PaletteGlyph';
import { useAutosave, type SaveStatus } from './editor/useAutosave';
import { useRemoteSync } from './editor/useRemoteSync';
import { stashConflictProject, type ProjectSource } from './editor/persistence';
import {
  DEFAULT_PLACEMENT_SIZE,
  elementFromPalette,
  paletteEntries,
  paletteEntryById,
  uniqueId,
} from './editor/palette';
import { getWorkspaceProjection3D, getWorkspaceView, workspaceViewIdsOf } from './workspace';
import { layoutViewInWorker, probeElkLayoutWorker } from './workers/elk-worker-client';

const elementKindLabel = {
  component: 'Component',
  container: 'Container',
  person: 'Person',
  softwareSystem: 'System',
} as const;

const elementGroupOrder: readonly Element['kind'][] = [
  'person',
  'softwareSystem',
  'container',
  'component',
];

const elementGroupLabel: Readonly<Record<Element['kind'], string>> = {
  component: 'Components',
  container: 'Containers',
  person: 'People',
  softwareSystem: 'Systems',
};

const SpatialDiagram = lazy(async () => {
  const module = await import('./components/SpatialDiagram');
  return { default: module.SpatialDiagram };
});

function ownElement(
  activeProject: ReadonlyProject,
  elementId: string,
): DeepReadonly<Element> | undefined {
  return Object.hasOwn(activeProject.elements, elementId)
    ? activeProject.elements[elementId]
    : undefined;
}

function relationshipCounterparty(
  activeProject: ReadonlyProject,
  relationship: DeepReadonly<Relationship>,
  selectedId: string,
): DeepReadonly<Element> | undefined {
  const counterpartyId =
    relationship.sourceId === selectedId ? relationship.targetId : relationship.sourceId;
  return ownElement(activeProject, counterpartyId);
}

function ModelExplorer({
  project,
  selectedElementId,
  selectedViewId,
  visibleElementIds,
  onSelectElement,
  onSelectView,
  onAddPaletteEntry,
  onCreateView,
  onDeleteView,
  onHide,
}: {
  readonly project: ReadonlyProject;
  readonly selectedElementId: ElementId | undefined;
  readonly selectedViewId: string;
  readonly visibleElementIds: ReadonlySet<string>;
  readonly onSelectElement: (elementId: ElementId) => void;
  readonly onSelectView: (viewId: string) => void;
  readonly onAddPaletteEntry: (entryId: string) => void;
  readonly onCreateView: () => void;
  readonly onDeleteView: (viewId: string) => void;
  readonly onHide: () => void;
}) {
  const elements = useMemo(
    () =>
      Object.values(project.elements).sort((left, right) => left.name.localeCompare(right.name)),
    [project],
  );

  return (
    <nav className="model-explorer" aria-label="Model explorer">
      <div className="panel-heading">
        <div>
          <h2>Model explorer</h2>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Hide the explorer"
          title="Hide the explorer"
          onClick={onHide}
        >
          «
        </button>
      </div>

      <div className="explorer-scroll">
        <section className="explorer-section" aria-labelledby="model-section-heading">
          <h3 id="model-section-heading">Model</h3>
          <div role="tree" aria-label="Architecture elements" className="model-tree">
            {elementGroupOrder.map((kind) => {
              const groupElements = elements.filter((element) => element.kind === kind);
              return (
                <details
                  className="tree-group"
                  key={kind}
                  role="group"
                  aria-label={elementGroupLabel[kind]}
                  open
                >
                  <summary className="tree-group__heading">
                    <span className="tree-group__label">
                      <span className="tree-group__caret" aria-hidden="true">
                        ▶
                      </span>
                      {elementGroupLabel[kind]}
                    </span>
                    <span>{groupElements.length}</span>
                  </summary>
                  {groupElements.map((element) => (
                    <button
                      key={element.id}
                      type="button"
                      role="treeitem"
                      aria-label={`${element.name}, ${elementKindLabel[element.kind]}`}
                      aria-selected={element.id === selectedElementId}
                      title={visibleElementIds.has(element.id) ? undefined : 'Not in this view'}
                      className={`tree-row tree-row--${element.kind}${element.id === selectedElementId ? ' is-selected' : ''}${visibleElementIds.has(element.id) ? '' : ' is-absent'}`}
                      onClick={() => onSelectElement(element.id)}
                    >
                      <span className="tree-row__marker" aria-hidden="true" />
                      <span className="tree-row__copy">
                        <strong>{element.name}</strong>
                        <small>{elementKindLabel[element.kind]}</small>
                      </span>
                      {element.tags.includes('external') ? (
                        <span className="external-dot" title="External element">
                          EXT
                        </span>
                      ) : null}
                    </button>
                  ))}
                </details>
              );
            })}
          </div>
        </section>

        <ObjectPalette onAdd={onAddPaletteEntry} />

        <section className="explorer-section" aria-labelledby="views-section-heading">
          <h3 id="views-section-heading">Views</h3>
          <div className="view-list">
            {workspaceViewIdsOf(project).map((viewId) => {
              const view = project.views[viewId];
              if (view === undefined) {
                return null;
              }
              const current = viewId === selectedViewId;
              const lastView = workspaceViewIdsOf(project).length === 1;
              return (
                <div key={viewId} className={`view-row${current ? ' is-current' : ''}`}>
                  <button
                    type="button"
                    className="view-row__open"
                    aria-current={current ? 'true' : undefined}
                    onClick={() => onSelectView(viewId)}
                  >
                    <span className="view-row__badge">{view.type}</span>
                    <span>
                      <strong>{view.name}</strong>
                    </span>
                  </button>
                  {lastView ? null : (
                    <button
                      type="button"
                      className="icon-button view-row__delete"
                      aria-label="Delete view"
                      title={`Delete ${view.name}`}
                      onClick={() => onDeleteView(viewId)}
                    >
                      ×
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <button type="button" className="ghost-button view-list__create" onClick={onCreateView}>
            + New view
          </button>
        </section>
      </div>
    </nav>
  );
}

/** Inline editor for one relationship, opened by clicking its line on the canvas. */
function EdgeEditor({
  relationship,
  x,
  y,
  onRename,
  onRetype,
  onDelete,
  onClose,
}: {
  readonly relationship: DeepReadonly<Relationship>;
  readonly x: number;
  readonly y: number;
  readonly onRename: (name: string) => void;
  readonly onRetype: (interaction: Relationship['interaction']) => void;
  readonly onDelete: () => void;
  readonly onClose: () => void;
}) {
  const editor = useRef<HTMLDivElement>(null);
  const [name, setName] = useState(relationship.name);

  useEffect(() => {
    setName(relationship.name);
  }, [relationship.name]);

  useEffect(() => {
    const closeOnOutside = (event: MouseEvent) => {
      if (editor.current !== null && !editor.current.contains(event.target as Node)) {
        onClose();
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('pointerdown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [onClose]);

  const commit = () => {
    const next = name.trim();
    if (next !== '' && next !== relationship.name) {
      onRename(next);
    } else {
      setName(relationship.name);
    }
  };

  return (
    <div
      ref={editor}
      className="edge-editor"
      style={{ left: x, top: y }}
      role="dialog"
      aria-label={`Edit relationship ${relationship.name}`}
    >
      <input
        aria-label="Relationship name"
        value={name}
        maxLength={120}
        onChange={(event) => setName(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.currentTarget.blur();
            onClose();
          }
        }}
      />
      <div className="edge-editor__row">
        <select
          aria-label="Interaction"
          value={relationship.interaction}
          onChange={(event) => onRetype(event.target.value as Relationship['interaction'])}
        >
          <option value="synchronous">synchronous</option>
          <option value="asynchronous">asynchronous</option>
        </select>
        <button
          type="button"
          className="danger-button"
          onClick={() => {
            onDelete();
            onClose();
          }}
        >
          Delete
        </button>
      </div>
    </div>
  );
}

/** Palette entries at the pointer: what a right-click on empty canvas opens. */
function StageAddMenu({
  x,
  y,
  onPick,
  onPickAnnotation,
  onClose,
}: {
  readonly x: number;
  readonly y: number;
  readonly onPick: (entryId: string) => void;
  readonly onPickAnnotation: (kind: ViewAnnotation['kind']) => void;
  readonly onClose: () => void;
}) {
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const closeOnOutside = (event: MouseEvent) => {
      if (menu.current !== null && !menu.current.contains(event.target as Node)) {
        onClose();
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('pointerdown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [onClose]);

  return (
    <div
      ref={menu}
      className="stage-add-menu"
      style={{ left: x, top: y }}
      role="menu"
      aria-label="Add element here"
    >
      <ul>
        {paletteEntries.map((entry) => (
          <li key={entry.id}>
            <button type="button" role="menuitem" onClick={() => onPick(entry.id)}>
              <PaletteGlyph id={entry.id} />
              {entry.label}
            </button>
          </li>
        ))}
        <li className="stage-add-menu__divider" role="separator" aria-hidden="true" />
        <li>
          <button type="button" role="menuitem" onClick={() => onPickAnnotation('boundary')}>
            <span className="palette-glyph palette-glyph--region" aria-hidden="true" />
            Region
          </button>
        </li>
        <li>
          <button type="button" role="menuitem" onClick={() => onPickAnnotation('note')}>
            <span className="palette-glyph palette-glyph--note" aria-hidden="true" />
            Note
          </button>
        </li>
      </ul>
    </div>
  );
}

function ViewTitle({
  viewId,
  name,
  autoEdit,
  onRename,
}: {
  readonly viewId: string;
  readonly name: string;
  readonly autoEdit: boolean;
  readonly onRename: (name: string) => void;
}) {
  const [draft, setDraft] = useState(name);
  const field = useRef<HTMLInputElement>(null);

  // The title is the editor: the canonical name can change under it via undo or a view switch.
  useEffect(() => {
    setDraft(name);
  }, [name, viewId]);

  useEffect(() => {
    if (autoEdit) {
      field.current?.focus();
      field.current?.select();
    }
  }, [autoEdit, viewId]);

  const commit = () => {
    const next = draft.trim();
    if (next !== '' && next !== name) {
      onRename(next);
    } else {
      setDraft(name);
    }
  };

  return (
    <h1>
      <input
        ref={field}
        className="view-title"
        aria-label="View name"
        value={draft}
        maxLength={120}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.currentTarget.blur();
          }
          if (event.key === 'Escape') {
            setDraft(name);
          }
        }}
      />
    </h1>
  );
}

function AppearanceControl({
  element,
  onUpdateElement,
}: {
  readonly element: DeepReadonly<Element>;
  readonly onUpdateElement: (
    elementId: ElementId,
    changes: ElementChanges,
  ) => CommandErrorData | undefined;
}) {
  const currentColor =
    typeof element.properties['color'] === 'string' ? element.properties['color'] : '';
  const currentIcon =
    typeof element.properties['icon'] === 'string' ? element.properties['icon'] : '';
  const setProperty = (key: 'color' | 'icon', value: string | undefined) => {
    const { [key]: _dropped, ...rest } = element.properties as Record<string, JsonValue>;
    const properties: Record<string, JsonValue> =
      value === undefined ? rest : { ...rest, [key]: value };
    onUpdateElement(element.id, { properties });
  };

  return (
    <div className="appearance-row">
      <label>
        <span>Icon</span>
        <select
          aria-label="Icon"
          value={currentIcon}
          onChange={(event) => {
            setProperty('icon', event.target.value === '' ? undefined : event.target.value);
          }}
        >
          <option value="">Automatic</option>
          {spatialModelKeys.map((key) => (
            <option key={key} value={key}>
              {ICON_LABELS[key]}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Block colour</span>
        <input
          type="color"
          aria-label="Block colour"
          value={currentColor === '' ? '#57a39c' : currentColor}
          onChange={(event) => setProperty('color', event.target.value)}
        />
      </label>
      <button
        type="button"
        className="ghost-button"
        disabled={currentColor === ''}
        onClick={() => setProperty('color', undefined)}
      >
        Use kind colour
      </button>
    </div>
  );
}

function RelationshipRow({
  relationship,
  outgoing,
  counterpartyName,
  onRename,
  onRetype,
  onDelete,
}: {
  readonly relationship: DeepReadonly<Relationship>;
  readonly outgoing: boolean;
  readonly counterpartyName: string;
  readonly onRename: (name: string) => void;
  readonly onRetype: (interaction: Relationship['interaction']) => void;
  readonly onDelete: () => void;
}) {
  const [name, setName] = useState(relationship.name);

  // The list is the editor: committing on blur or Enter keeps a rename to one gesture, and a
  // rejected name simply falls back to the one the model still holds.
  const commit = () => {
    const next = name.trim();
    if (next !== '' && next !== relationship.name) {
      onRename(next);
    } else if (next === '') {
      setName(relationship.name);
    }
  };

  return (
    <li>
      <span className={`relationship-direction${outgoing ? ' is-outgoing' : ''}`}>
        {outgoing ? '→' : '←'}
      </span>
      <div>
        <input
          className="relationship-name"
          aria-label={`Name of relationship ${relationship.name}`}
          value={name}
          maxLength={80}
          onChange={(event) => setName(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.currentTarget.blur();
            }
            if (event.key === 'Escape') {
              setName(relationship.name);
            }
          }}
        />
        <span>
          {outgoing ? 'to' : 'from'} {counterpartyName}
        </span>
        <select
          className="relationship-interaction"
          aria-label={`Interaction of relationship ${relationship.name}`}
          value={relationship.interaction}
          onChange={(event) => onRetype(event.target.value as Relationship['interaction'])}
        >
          <option value="synchronous">synchronous</option>
          <option value="asynchronous">asynchronous</option>
        </select>
      </div>
      <button
        type="button"
        className="icon-button relationship-remove"
        aria-label={`Delete relationship ${relationship.name}`}
        onClick={onDelete}
      >
        ×
      </button>
    </li>
  );
}

function ConnectControl({
  element,
  project,
  onConnect,
}: {
  readonly element: DeepReadonly<Element>;
  readonly project: ReadonlyProject;
  readonly onConnect: (targetId: ElementId) => void;
}) {
  const [targetId, setTargetId] = useState('');
  const candidates = useMemo(
    () =>
      Object.values(project.elements)
        .filter((candidate) => candidate.id !== element.id)
        .sort((left, right) => left.name.localeCompare(right.name)),
    [element.id, project.elements],
  );

  return (
    <form
      className="connect-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (targetId !== '') {
          onConnect(targetId as ElementId);
          setTargetId('');
        }
      }}
    >
      <label>
        <span>Connect to</span>
        <select value={targetId} onChange={(event) => setTargetId(event.target.value)}>
          <option value="">Select an element…</option>
          {candidates.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className="ghost-button" disabled={targetId === ''}>
        Add relationship
      </button>
    </form>
  );
}

function Inspector({
  project,
  selectedElementId,
  onClear,
  onUpdateElement,
  onDeleteElement,
  onConnect,
  onUpdateRelationship,
  onDeleteRelationship,
  renamingElementId,
  inCurrentView,
  onAddToView,
  onRemoveFromView,
  onHide,
}: {
  readonly project: ReadonlyProject;
  readonly selectedElementId: ElementId | undefined;
  readonly onClear: () => void;
  readonly onUpdateElement: (
    elementId: ElementId,
    changes: ElementChanges,
  ) => CommandErrorData | undefined;
  readonly onDeleteElement: (elementId: ElementId) => void;
  readonly onConnect: (sourceId: ElementId, targetId: ElementId, name: string) => void;
  readonly onUpdateRelationship: (relationshipId: string, changes: RelationshipChanges) => void;
  readonly onDeleteRelationship: (relationshipId: string) => void;
  /** Element just authored from the palette, whose placeholder name is ready to be typed over. */
  readonly renamingElementId: ElementId | undefined;
  readonly inCurrentView: boolean;
  readonly onAddToView: (elementId: ElementId) => void;
  readonly onRemoveFromView: (elementId: ElementId) => void;
  readonly onHide: () => void;
}) {
  const element =
    selectedElementId === undefined ? undefined : ownElement(project, selectedElementId);
  const relationships = useMemo(
    () =>
      selectedElementId === undefined
        ? []
        : Object.values(project.relationships).filter(
            (relationship) =>
              relationship.sourceId === selectedElementId ||
              relationship.targetId === selectedElementId,
          ),
    [project, selectedElementId],
  );

  return (
    <aside className="inspector" aria-label="Inspector">
      <button
        type="button"
        className="icon-button inspector-hide"
        aria-label="Hide the inspector"
        title="Hide the inspector"
        onClick={onHide}
      >
        »
      </button>
      {element === undefined ? (
        <div className="inspector-empty">
          <span className="empty-glyph" aria-hidden="true">
            ⌖
          </span>
          <h2>Nothing selected</h2>
        </div>
      ) : (
        <div className="inspector-content">
          <div className="inspector-title">
            <div>
              <span className={`kind-chip kind-chip--${element.kind}`}>
                {elementKindLabel[element.kind]}
              </span>
              <h2>{element.name}</h2>
            </div>
            <button
              type="button"
              className="icon-button"
              onClick={onClear}
              aria-label="Clear selection"
            >
              ×
            </button>
          </div>

          <details className="inspector-section" open>
            <summary className="inspector-section__summary">
              <span className="tree-group__caret" aria-hidden="true">
                ▶
              </span>
              <h3>Definition</h3>
            </summary>
            <ElementInspectorForm
              key={element.id}
              element={element}
              renaming={element.id === renamingElementId}
              onSubmit={(changes) => onUpdateElement(element.id, changes)}
            />
          </details>

          <details className="inspector-section" open>
            <summary className="inspector-section__summary">
              <span className="tree-group__caret" aria-hidden="true">
                ▶
              </span>
              <h3>Appearance</h3>
            </summary>
            <AppearanceControl element={element} onUpdateElement={onUpdateElement} />
          </details>

          <details className="inspector-section" open>
            <summary className="inspector-section__summary">
              <span className="tree-group__caret" aria-hidden="true">
                ▶
              </span>
              <h3>Relationships</h3>
              <span className="inspector-section__count">{relationships.length}</span>
            </summary>
            {relationships.length === 0 ? (
              <p className="quiet-copy">No relationships.</p>
            ) : (
              <ul className="relationship-list">
                {relationships.map((relationship) => {
                  const outgoing = relationship.sourceId === element.id;
                  const counterparty = relationshipCounterparty(project, relationship, element.id);
                  return (
                    <RelationshipRow
                      key={relationship.id}
                      relationship={relationship}
                      outgoing={outgoing}
                      counterpartyName={counterparty?.name ?? 'Unknown element'}
                      onRename={(name) => onUpdateRelationship(relationship.id, { name })}
                      onRetype={(interaction) =>
                        onUpdateRelationship(relationship.id, { interaction })
                      }
                      onDelete={() => onDeleteRelationship(relationship.id)}
                    />
                  );
                })}
              </ul>
            )}
            <ConnectControl
              key={element.id}
              element={element}
              project={project}
              onConnect={(targetId) => onConnect(element.id, targetId, 'Uses')}
            />
          </details>

          <section className="inspector-section inspector-section--datum">
            <div className="inspector-actions">
              {inCurrentView ? (
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => onRemoveFromView(element.id)}
                >
                  Remove from view
                </button>
              ) : (
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => onAddToView(element.id)}
                >
                  Add to this view
                </button>
              )}
              <button
                type="button"
                className="danger-button"
                onClick={() => onDeleteElement(element.id)}
              >
                Delete element
              </button>
            </div>
          </section>
        </div>
      )}
    </aside>
  );
}

const PANEL_LIMITS = {
  explorer: { min: 200, max: 520, fallback: 272 },
  inspector: { min: 240, max: 560, fallback: 320 },
} as const;

/**
 * Draggable edge of a side panel. Drag stretches the panel, arrow keys nudge it, and a
 * double-click returns it to the stylesheet default (which keeps the responsive breakpoints).
 */
function PanelResizer({
  side,
  width,
  onResize,
}: {
  readonly side: 'explorer' | 'inspector';
  readonly width: number | undefined;
  readonly onResize: (width: number | undefined) => void;
}) {
  const { min, max, fallback } = PANEL_LIMITS[side];
  const clamp = (value: number) => Math.min(max, Math.max(min, value));
  return (
    <div
      className={`panel-resize panel-resize--${side}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={side === 'explorer' ? 'Resize the explorer' : 'Resize the inspector'}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={width ?? fallback}
      tabIndex={0}
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
          return;
        }
        onResize(clamp(side === 'explorer' ? event.clientX : window.innerWidth - event.clientX));
      }}
      onDoubleClick={() => onResize(undefined)}
      onKeyDown={(event) => {
        const grow = side === 'explorer' ? 'ArrowRight' : 'ArrowLeft';
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
          return;
        }
        event.preventDefault();
        onResize(clamp((width ?? fallback) + (event.key === grow ? 16 : -16)));
      }}
    />
  );
}

export function App({
  initialProjectSource = 'disk',
}: {
  readonly initialProjectSource?: ProjectSource;
}) {
  const project = useEditorStore((state) => state.history.project);
  const viewId = useEditorStore((state) => state.activeViewId);
  const mode = useEditorStore((state) => state.mode);
  const selectedElementId = useEditorStore((state) => state.primarySelectedElementId);
  const selectedElementIds = useEditorStore((state) => state.selectedElementIds);
  const setViewId = useEditorStore((state) => state.setActiveView);
  const setMode = useEditorStore((state) => state.setMode);
  const tool = useEditorStore((state) => state.tool);
  const setTool = useEditorStore((state) => state.setTool);
  const setSelection = useEditorStore((state) => state.setSelection);
  const toggleSelection = useEditorStore((state) => state.toggleSelection);
  const execute = useEditorStore((state) => state.execute);
  const clearError = useEditorStore((state) => state.clearError);
  const storeApi = useEditorStoreApi();
  const [layoutWorkerState, setLayoutWorkerState] = useState<'checking' | 'ready' | 'unavailable'>(
    'checking',
  );
  // First click of the connect tool arms a source; the second click completes the relationship.
  const [pendingSourceId, setPendingSourceId] = useState<ElementId | undefined>(undefined);
  const [revealSignal, setRevealSignal] = useState(0);
  const [renamingElementId, setRenamingElementId] = useState<ElementId | undefined>(undefined);
  const [freshViewId, setFreshViewId] = useState<string | undefined>(undefined);
  const [explorerOpen, setExplorerOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  // undefined = the stylesheet default, so the responsive breakpoints stay in charge until a drag.
  const [explorerWidth, setExplorerWidth] = useState<number | undefined>(undefined);
  const [inspectorWidth, setInspectorWidth] = useState<number | undefined>(undefined);
  const [editingEdge, setEditingEdge] = useState<
    { readonly relationshipId: string; readonly x: number; readonly y: number } | undefined
  >(undefined);
  const [addAt, setAddAt] = useState<
    | { readonly x: number; readonly y: number; readonly placement: { x: number; y: number } }
    | undefined
  >(undefined);
  const workspaceView = useMemo(() => getWorkspaceView(project, viewId), [project, viewId]);
  const visibleElementIds = useMemo(
    () => new Set<string>(workspaceView.compiled.items.map((item) => item.elementId)),
    [workspaceView.compiled.items],
  );
  const projection3D = useMemo(
    () => (mode === '3d' ? getWorkspaceProjection3D(project, viewId) : undefined),
    [mode, project, viewId],
  );
  const connectElementsRef = useRef<(source: ElementId, target: ElementId, name: string) => void>(
    () => undefined,
  );

  const selectElement = useCallback(
    (elementId: string | undefined, additive = false) => {
      if (elementId === undefined) {
        setSelection([]);
        return;
      }
      const selectedId = elementId as ElementId;
      if (additive) {
        toggleSelection(selectedId);
        return;
      }
      setSelection([selectedId], selectedId);
    },
    [setSelection, toggleSelection],
  );
  const activateElement = useCallback(
    (elementId: string | undefined, additive = false) => {
      if (tool !== 'connect') {
        selectElement(elementId, additive);
        return;
      }
      if (elementId === undefined) {
        setPendingSourceId(undefined);
        setSelection([]);
        return;
      }
      const clicked = elementId as ElementId;
      if (pendingSourceId === undefined || pendingSourceId === clicked) {
        setPendingSourceId(clicked);
        setSelection([clicked], clicked);
        return;
      }
      connectElementsRef.current(pendingSourceId, clicked, 'Uses');
      setPendingSourceId(undefined);
    },
    [pendingSourceId, selectElement, setSelection, tool],
  );

  const requestEditRelationship = useCallback(
    (request: { relationshipId: string; clientX: number; clientY: number }) => {
      const stage = stageRef.current?.getBoundingClientRect();
      if (stage === undefined) {
        return;
      }
      setEditingEdge({
        relationshipId: request.relationshipId,
        x: Math.min(request.clientX - stage.left, stage.width - 240),
        y: Math.min(request.clientY - stage.top, stage.height - 120),
      });
    },
    [],
  );

  const viewAnnotations = useMemo(
    () => project.views[viewId]?.annotations ?? {},
    [project.views, viewId],
  );
  const updateAnnotations = useCallback(
    (annotations: Readonly<Record<string, ViewAnnotation>>) => {
      execute({ type: 'update-view', viewId, changes: { annotations } });
    },
    [execute, viewId],
  );
  const addAnnotation = useCallback(
    (kind: ViewAnnotation['kind'], point: { readonly x: number; readonly y: number }) => {
      const annotationId = uniqueId(project, kind, (candidate) =>
        Object.hasOwn(viewAnnotations, candidate),
      );
      const size = kind === 'boundary' ? { width: 420, height: 280 } : { width: 220, height: 64 };
      updateAnnotations({
        ...viewAnnotations,
        [annotationId]: {
          id: annotationId,
          kind,
          x: Math.round(point.x - size.width / 2),
          y: Math.round(point.y - size.height / 2),
          ...size,
        } as ViewAnnotation,
      });
    },
    [project, updateAnnotations, viewAnnotations],
  );

  // Auto-arrange: ELK lays out the current view once, committed as one undoable move command,
  // and every placement stays hand-editable afterwards.
  const [arranging, setArranging] = useState(false);
  const arrangeView = useCallback(() => {
    setArranging(true);
    void layoutViewInWorker(workspaceView.twoD)
      .then((preview) => {
        const moves = Object.entries(preview.placements).map(([itemId, placement]) => ({
          itemId,
          x: Math.round(placement.x),
          y: Math.round(placement.y),
        }));
        if (moves.length > 0) {
          execute({ type: 'move-view-items', viewId, moves });
          setRevealSignal((signal) => signal + 1);
        }
      })
      .catch(() => window.alert('The layout worker is unavailable; nothing was moved.'))
      .finally(() => setArranging(false));
  }, [execute, viewId, workspaceView.twoD]);

  // C4 drill-down: a double-clicked element opens the view scoped to it, when one exists.
  const drillDown = useCallback(
    (elementId: string) => {
      const target = Object.keys(project.views).find(
        (candidate) =>
          candidate !== viewId && project.views[candidate]?.scopeElementId === elementId,
      );
      if (target !== undefined) {
        setViewId(target);
      }
    },
    [project.views, setViewId, viewId],
  );

  const requestAddAt = useCallback(
    (request: { clientX: number; clientY: number; placement: { x: number; y: number } }) => {
      const stage = stageRef.current?.getBoundingClientRect();
      if (stage === undefined) {
        return;
      }
      setAddAt({
        x: Math.min(request.clientX - stage.left, stage.width - 168),
        y: Math.min(request.clientY - stage.top, stage.height - 240),
        placement: request.placement,
      });
    },
    [],
  );

  const moveViewItems = useCallback(
    (moves: readonly ViewItemMove[]) => {
      execute({ type: 'move-view-items', viewId, moves });
    },
    [execute, viewId],
  );
  const dropPaletteEntry = useCallback(
    (entryId: string, point: { readonly x: number; readonly y: number }) => {
      const entry = paletteEntryById(entryId);
      const view = project.views[viewId];
      if (entry === undefined || view === undefined) {
        return;
      }
      const elementId = uniqueId(project, entry.label, (candidate) =>
        Object.hasOwn(project.elements, candidate),
      );
      const itemId = uniqueId(project, `${viewId}-item-${elementId}`, (candidate) =>
        Object.hasOwn(view.items, candidate),
      );
      execute({
        type: 'create-element',
        element: elementFromPalette(entry, project, view, elementId),
        placeInView: {
          viewId,
          itemId,
          // The drop point is the centre of the new block, not its top-left corner.
          placement: {
            x: Math.round(point.x - DEFAULT_PLACEMENT_SIZE.width / 2),
            y: Math.round(point.y - DEFAULT_PLACEMENT_SIZE.height / 2),
            width: DEFAULT_PLACEMENT_SIZE.width,
            height: DEFAULT_PLACEMENT_SIZE.height,
          },
        },
      });
      if (storeApi.getState().lastCommandError === undefined) {
        setSelection([elementId as ElementId], elementId as ElementId);
        setRenamingElementId(elementId as ElementId);
      }
    },
    [execute, project, setSelection, storeApi, viewId],
  );

  // Adds with no pointer to aim them park just clear of everything already placed in this view.
  const parkedSpot = useCallback(() => {
    const placements = Object.values(project.views[viewId]?.placements ?? {});
    const right =
      placements.length === 0 ? 0 : Math.max(...placements.map((place) => place.x + place.width));
    const top = placements.length === 0 ? 0 : Math.min(...placements.map((place) => place.y));
    return { x: right + 80, y: top };
  }, [project.views, viewId]);

  const quickAdd = useCallback(
    (entryId: string) => {
      const spot = parkedSpot();
      dropPaletteEntry(entryId, {
        x: spot.x + DEFAULT_PLACEMENT_SIZE.width / 2,
        y: spot.y + DEFAULT_PLACEMENT_SIZE.height / 2,
      });
      // Nothing aimed this drop, so re-frame the canvas rather than leave it off-screen.
      setRevealSignal((signal) => signal + 1);
    },
    [dropPaletteEntry, parkedSpot],
  );

  const createView = useCallback(() => {
    const elements = Object.values(project.elements);
    const scope =
      elements.find(
        (candidate) => candidate.kind === 'softwareSystem' && !candidate.tags.includes('external'),
      ) ?? elements[0];
    if (scope === undefined) {
      return;
    }
    const newViewId = uniqueId(project, 'view', (candidate) =>
      Object.hasOwn(project.views, candidate),
    );
    execute({
      type: 'create-view',
      view: {
        id: newViewId,
        name: 'Untitled view',
        type: 'container',
        scopeElementId: scope.id,
        items: {},
        placements: {},
        relationshipIds: [],
      },
    });
    if (storeApi.getState().lastCommandError === undefined) {
      setViewId(newViewId);
      setFreshViewId(newViewId);
    }
  }, [execute, project, setViewId, storeApi]);

  const deleteView = useCallback(
    (deletedViewId: string) => {
      execute({ type: 'delete-view', viewId: deletedViewId });
    },
    [execute],
  );

  const addElementToView = useCallback(
    (elementId: ElementId) => {
      const view = project.views[viewId];
      if (view === undefined) {
        return;
      }
      const itemId = uniqueId(project, `${viewId}-item-${elementId}`, (candidate) =>
        Object.hasOwn(view.items, candidate),
      );
      const spot = parkedSpot();
      execute({
        type: 'add-view-item',
        viewId,
        itemId,
        elementId,
        placement: { ...spot, ...DEFAULT_PLACEMENT_SIZE },
      });
      if (storeApi.getState().lastCommandError === undefined) {
        setRevealSignal((signal) => signal + 1);
      }
    },
    [execute, parkedSpot, project, storeApi, viewId],
  );

  const removeElementFromView = useCallback(
    (elementId: ElementId) => {
      const view = project.views[viewId];
      const itemId = Object.keys(view?.items ?? {}).find(
        (candidate) => view?.items[candidate]?.elementId === elementId,
      );
      if (itemId !== undefined) {
        execute({ type: 'remove-view-item', viewId, itemId });
      }
    },
    [execute, project.views, viewId],
  );

  const deleteElement = useCallback(
    (elementId: ElementId) => {
      execute({ type: 'delete-element', elementId });
      const error = storeApi.getState().lastCommandError;
      // Descendants are only removed on an explicit second pass, so the loss is never silent.
      if (
        error?.code === 'CASCADE_REQUIRED' &&
        window.confirm(
          'This element has nested elements. Delete it together with everything inside it?',
        )
      ) {
        clearError();
        execute({ type: 'delete-element', elementId, cascade: true });
      }
    },
    [clearError, execute, storeApi],
  );

  const connectElements = useCallback(
    (sourceId: ElementId, targetId: ElementId, name: string) => {
      const relationshipId = uniqueId(project, `${sourceId}-${targetId}`, (candidate) =>
        Object.hasOwn(project.relationships, candidate),
      );
      execute({
        type: 'create-relationship',
        relationship: {
          id: relationshipId,
          name,
          sourceId,
          targetId,
          interaction: 'synchronous',
          tags: [],
          properties: {},
          externalRefs: [],
        },
        showInViewId: viewId,
      });
    },
    [execute, project, viewId],
  );
  connectElementsRef.current = connectElements;

  const updateRelationship = useCallback(
    (relationshipId: string, changes: RelationshipChanges) => {
      execute({ type: 'update-relationship', relationshipId, changes });
    },
    [execute],
  );

  const deleteRelationship = useCallback(
    (relationshipId: string) => {
      execute({ type: 'delete-relationship', relationshipId });
    },
    [execute],
  );

  const updateElement = useCallback(
    (elementId: ElementId, changes: ElementChanges) => {
      execute({ type: 'update-element', elementId, changes });
      // The inspector renders its own rejection inline next to the offending field, so hand the
      // error to it and keep it out of the stage-level banner.
      const error = storeApi.getState().lastCommandError;
      if (error !== undefined) {
        clearError();
      }
      return error;
    },
    [clearError, execute, storeApi],
  );

  useEffect(() => {
    if (freshViewId !== undefined && freshViewId !== viewId) {
      setFreshViewId(undefined);
    }
  }, [freshViewId, viewId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTextEntryTarget(event.target)) {
        return;
      }
      if (event.key === 'Escape') {
        setPendingSourceId(undefined);
        setTool('select');
        setSelection([]);
        return;
      }
      if ((event.key === 'v' || event.key === 'V') && !event.metaKey && !event.ctrlKey) {
        setTool('select');
        setPendingSourceId(undefined);
        return;
      }
      if ((event.key === 'c' || event.key === 'C') && !event.metaKey && !event.ctrlKey) {
        setTool('connect');
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        const selected = storeApi.getState().selectedElementIds;
        if (selected.length > 0) {
          event.preventDefault();
          selected.forEach((elementId) => deleteElement(elementId));
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [deleteElement, setSelection, setTool, storeApi]);

  useEffect(() => {
    let active = true;
    void probeElkLayoutWorker()
      .then((ready) => {
        if (active) {
          setLayoutWorkerState(ready ? 'ready' : 'unavailable');
        }
      })
      .catch(() => {
        if (active) {
          setLayoutWorkerState('unavailable');
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const replaceProject = useEditorStore((state) => state.replaceProject);
  const stageRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);
  const adoptedProjectRef = useRef<ReadonlyProject | null>(null);
  const saveStatus = useAutosave(project, adoptedProjectRef, initialProjectSource);
  const saveStatusRef = useRef<SaveStatus>(saveStatus);
  saveStatusRef.current = saveStatus;
  const adoptExternalProject = useCallback(
    (incoming: ReadonlyProject) => {
      const current = storeApi.getState().history.project;
      // A burst that lost a save conflict is stashed before disk wins, never silently dropped.
      if (saveStatusRef.current === 'conflict') {
        stashConflictProject(current);
      }
      adoptedProjectRef.current = incoming;
      replaceProject(incoming);
    },
    [replaceProject, storeApi],
  );
  const canAdoptExternal = useCallback(() => {
    const current = saveStatusRef.current;
    // A browser-only or failed save is the sole durable copy and must never yield to disk. A
    // confirmed conflict may yield because adoptExternalProject stashes it first.
    return current === 'idle' || current === 'saved-disk' || current === 'conflict';
  }, []);
  useRemoteSync(adoptExternalProject, canAdoptExternal);
  const exportPng = useCallback(
    (embedProject: boolean) => {
      const surface = stageRef.current?.querySelector('.diagram-surface');
      if (!(surface instanceof HTMLElement)) {
        return;
      }
      // The grid hides for the capture. A plain export is only the picture; the portable one also
      // carries the whole project as an iTXt chunk, so Open project… accepts the image back.
      setExporting(true);
      void new Promise((settle) => setTimeout(settle, 150))
        .then(() => import('html-to-image'))
        .then(({ toPng }) => toPng(surface, { backgroundColor: '#f5f7f5', pixelRatio: 2 }))
        .then((dataUrl) => {
          const bytes = Uint8Array.from(atob(dataUrl.split(',')[1] ?? ''), (char) =>
            char.charCodeAt(0),
          );
          const out = embedProject ? embedProjectInPng(bytes, JSON.stringify(project)) : bytes;
          const blob = new Blob([out.slice().buffer], { type: 'image/png' });
          const url = URL.createObjectURL(blob);
          downloadDataUrl(`${fileStem(project.name)}${embedProject ? '.cd3' : ''}.png`, url);
          URL.revokeObjectURL(url);
        })
        .catch(() => window.alert('The image export failed.'))
        .finally(() => setExporting(false));
    },
    [project],
  );
  const warningCount = workspaceView.compiled.warnings.length;

  return (
    <div
      className={`app-shell${explorerOpen ? '' : ' app-shell--no-explorer'}${
        inspectorOpen ? '' : ' app-shell--no-inspector'
      }`}
      style={
        {
          ...(explorerWidth === undefined
            ? {}
            : { '--explorer-width': `${String(explorerWidth)}px` }),
          ...(inspectorWidth === undefined
            ? {}
            : { '--inspector-width': `${String(inspectorWidth)}px` }),
        } as CSSProperties
      }
    >
      <header className="global-header">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            C<span>D</span>3
          </span>
          <span className="header-divider" aria-hidden="true" />
          <div className="breadcrumb">
            <strong>{project.name}</strong>
          </div>
        </div>
        <div className="header-actions">
          <WorkspaceMenu
            project={project}
            status={saveStatus}
            onExportPng={exportPng}
            onReplaceProject={replaceProject}
          />
        </div>
      </header>

      {explorerOpen ? (
        <ModelExplorer
          project={project}
          selectedElementId={selectedElementId}
          selectedViewId={viewId}
          visibleElementIds={visibleElementIds}
          onSelectElement={selectElement}
          onSelectView={setViewId}
          onAddPaletteEntry={quickAdd}
          onCreateView={createView}
          onDeleteView={deleteView}
          onHide={() => setExplorerOpen(false)}
        />
      ) : null}
      {explorerOpen ? (
        <PanelResizer side="explorer" width={explorerWidth} onResize={setExplorerWidth} />
      ) : null}

      <main className="stage">
        <div className="stage-bar">
          <div className="stage-title">
            <div>
              <span className="panel-eyebrow">{workspaceView.compiled.type} view</span>
              <ViewTitle
                viewId={viewId}
                name={workspaceView.compiled.name}
                autoEdit={viewId === freshViewId}
                onRename={(name) => {
                  execute({ type: 'update-view', viewId, changes: { name } });
                }}
              />
            </div>
          </div>
          <div className="stage-tools">
            <EditorToolbar />
            <div className="segmented" role="group" aria-label="Pointer tool">
              <button
                type="button"
                aria-label="Select and move"
                title="Select and move (V)"
                aria-pressed={tool === 'select'}
                onClick={() => {
                  setTool('select');
                  setPendingSourceId(undefined);
                }}
              >
                Select
              </button>
              <button
                type="button"
                aria-label="Connect elements"
                title="Connect elements (C)"
                aria-pressed={tool === 'connect'}
                onClick={() => setTool('connect')}
              >
                Connect
              </button>
            </div>
            <div className="segmented" role="group" aria-label="Projection mode">
              <button
                type="button"
                aria-label="2D diagram view"
                aria-pressed={mode === '2d'}
                onClick={() => setMode('2d')}
              >
                2D
              </button>
              <button
                type="button"
                aria-label="3D spatial view"
                aria-pressed={mode === '3d'}
                onClick={() => setMode('3d')}
              >
                3D
              </button>
            </div>
          </div>
        </div>

        <CommandErrorBanner />

        <div className="stage-canvas" ref={stageRef}>
          {explorerOpen ? null : (
            <button
              type="button"
              className="explorer-reveal"
              aria-label="Show the explorer"
              title="Show the explorer"
              onClick={() => setExplorerOpen(true)}
            >
              » Explorer
            </button>
          )}
          {mode === '3d' ? (
            <button
              type="button"
              className="spatial-fit"
              aria-label="Fit view"
              title="Fit view"
              onClick={() => setRevealSignal((signal) => signal + 1)}
            >
              ⛶
            </button>
          ) : null}
          {(() => {
            if (editingEdge === undefined) {
              return null;
            }
            const relationship = project.relationships[editingEdge.relationshipId];
            if (relationship === undefined) {
              return null;
            }
            return (
              <EdgeEditor
                relationship={relationship}
                x={editingEdge.x}
                y={editingEdge.y}
                onRename={(name) => updateRelationship(relationship.id, { name })}
                onRetype={(interaction) => updateRelationship(relationship.id, { interaction })}
                onDelete={() => deleteRelationship(relationship.id)}
                onClose={() => setEditingEdge(undefined)}
              />
            );
          })()}
          {addAt === undefined ? null : (
            <StageAddMenu
              x={addAt.x}
              y={addAt.y}
              onPick={(entryId) => {
                dropPaletteEntry(entryId, addAt.placement);
                setAddAt(undefined);
              }}
              onPickAnnotation={(kind) => {
                addAnnotation(kind, addAt.placement);
                setAddAt(undefined);
              }}
              onClose={() => setAddAt(undefined)}
            />
          )}
          <StageQuickBar
            selectionCount={selectedElementIds.length}
            hint={
              tool === 'connect'
                ? pendingSourceId === undefined
                  ? 'Connect: click a source element'
                  : 'Connect: click a target element'
                : undefined
            }
            onAdd={quickAdd}
            onDelete={() => selectedElementIds.forEach((elementId) => deleteElement(elementId))}
            onRevealInspector={inspectorOpen ? undefined : () => setInspectorOpen(true)}
            onArrange={layoutWorkerState === 'ready' && !arranging ? arrangeView : undefined}
          />
          {mode === '2d' ? (
            <Diagram2D
              projection={workspaceView.twoD}
              selectedElementId={selectedElementId}
              selectedElementIds={selectedElementIds}
              onSelect={activateElement}
              onMoveItems={moveViewItems}
              onDropPaletteEntry={dropPaletteEntry}
              onConnectElements={(sourceId, targetId) =>
                connectElements(sourceId as ElementId, targetId as ElementId, 'Uses')
              }
              connecting={tool === 'connect'}
              revealSignal={revealSignal}
              onRequestAddAt={requestAddAt}
              onEditRelationship={requestEditRelationship}
              onDrillDown={drillDown}
              showGrid={!exporting}
              annotations={viewAnnotations}
              onUpdateAnnotations={updateAnnotations}
            />
          ) : projection3D === undefined ? null : (
            <Suspense
              fallback={
                <section className="projection-loading" aria-label="Preparing 3D projection">
                  <span className="panel-eyebrow">Derived spatial view</span>
                  <strong>Preparing 3D projection…</strong>
                </section>
              }
            >
              <SpatialDiagram
                projection={projection3D}
                selectedElementId={selectedElementId}
                selectedElementIds={selectedElementIds}
                onSelect={activateElement}
                onMoveItems={moveViewItems}
                onDropPaletteEntry={dropPaletteEntry}
                connecting={tool === 'connect'}
                revealSignal={revealSignal}
                onRequestAddAt={requestAddAt}
                pendingSourceElementId={pendingSourceId}
                onDrillDown={drillDown}
                showGrid={!exporting}
                annotations={viewAnnotations}
              />
            </Suspense>
          )}
        </div>
      </main>

      {inspectorOpen ? (
        <Inspector
          project={project}
          selectedElementId={selectedElementId}
          onClear={() => setSelection([])}
          onUpdateElement={updateElement}
          onDeleteElement={deleteElement}
          onConnect={connectElements}
          onUpdateRelationship={updateRelationship}
          onDeleteRelationship={deleteRelationship}
          renamingElementId={renamingElementId}
          inCurrentView={
            selectedElementId !== undefined && visibleElementIds.has(selectedElementId)
          }
          onAddToView={addElementToView}
          onRemoveFromView={removeElementFromView}
          onHide={() => setInspectorOpen(false)}
        />
      ) : null}
      {inspectorOpen ? (
        <PanelResizer side="inspector" width={inspectorWidth} onResize={setInspectorWidth} />
      ) : null}

      <footer
        className="status-strip"
        role="status"
        aria-live="polite"
        aria-label="Workspace status"
      >
        <div>
          <span>{workspaceView.compiled.items.length} elements</span>
          <span>{workspaceView.compiled.relationships.length} relationships</span>
        </div>
        <div>
          {warningCount === 0 ? null : <span>{warningCount} warnings</span>}
          {layoutWorkerState === 'unavailable' ? <span>Layout worker unavailable</span> : null}
        </div>
      </footer>
    </div>
  );
}
