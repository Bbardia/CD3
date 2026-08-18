import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  DeepReadonly,
  Element,
  JsonValue,
  ElementChanges,
  ElementId,
  ReadonlyProject,
  Relationship,
  RelationshipChanges,
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
import { useAutosave } from './editor/useAutosave';
import {
  DEFAULT_PLACEMENT_SIZE,
  elementFromPalette,
  paletteEntryById,
  uniqueId,
} from './editor/palette';
import {
  getWorkspaceProjection3D,
  getWorkspaceView,
  workspaceViewIds,
  type WorkspaceViewId,
} from './workspace';
import { probeElkLayoutWorker } from './workers/elk-worker-client';

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
  onSelectElement,
  onSelectView,
  onAddPaletteEntry,
}: {
  readonly project: ReadonlyProject;
  readonly selectedElementId: ElementId | undefined;
  readonly selectedViewId: WorkspaceViewId;
  readonly onSelectElement: (elementId: ElementId) => void;
  readonly onSelectView: (viewId: WorkspaceViewId) => void;
  readonly onAddPaletteEntry: (entryId: string) => void;
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
      </div>

      <div className="explorer-scroll">
        <section className="explorer-section" aria-labelledby="model-section-heading">
          <h3 id="model-section-heading">Model</h3>
          <div role="tree" aria-label="Architecture elements" className="model-tree">
            {elementGroupOrder.map((kind) => {
              const groupElements = elements.filter((element) => element.kind === kind);
              return (
                <div
                  className="tree-group"
                  key={kind}
                  role="group"
                  aria-label={elementGroupLabel[kind]}
                >
                  <div className="tree-group__heading">
                    <span>{elementGroupLabel[kind]}</span>
                    <span>{groupElements.length}</span>
                  </div>
                  {groupElements.map((element) => (
                    <button
                      key={element.id}
                      type="button"
                      role="treeitem"
                      aria-label={`${element.name}, ${elementKindLabel[element.kind]}`}
                      aria-selected={element.id === selectedElementId}
                      className={`tree-row tree-row--${element.kind}${element.id === selectedElementId ? ' is-selected' : ''}`}
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
                </div>
              );
            })}
          </div>
        </section>

        <ObjectPalette onAdd={onAddPaletteEntry} />

        <section className="explorer-section" aria-labelledby="views-section-heading">
          <h3 id="views-section-heading">Views</h3>
          <div className="view-list">
            {workspaceViewIds.map((viewId) => {
              const view = project.views[viewId];
              if (view === undefined) {
                return null;
              }
              const current = viewId === selectedViewId;
              return (
                <button
                  key={viewId}
                  type="button"
                  className={`view-row${current ? ' is-current' : ''}`}
                  aria-current={current ? 'true' : undefined}
                  onClick={() => onSelectView(viewId)}
                >
                  <span className="view-row__badge">{view.type}</span>
                  <span>
                    <strong>{view.name}</strong>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </nav>
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
  const current =
    typeof element.properties['color'] === 'string' ? element.properties['color'] : '';
  const setColor = (color: string | undefined) => {
    const { color: _dropped, ...rest } = element.properties as Record<string, JsonValue>;
    const properties: Record<string, JsonValue> = color === undefined ? rest : { ...rest, color };
    onUpdateElement(element.id, { properties });
  };

  return (
    <div className="appearance-row">
      <label>
        <span>Block colour</span>
        <input
          type="color"
          aria-label="Block colour"
          value={current === '' ? '#57a39c' : current}
          onChange={(event) => setColor(event.target.value)}
        />
      </label>
      <button
        type="button"
        className="ghost-button"
        disabled={current === ''}
        onClick={() => setColor(undefined)}
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

          <section className="inspector-section">
            <h3>Definition</h3>
            <ElementInspectorForm
              key={element.id}
              element={element}
              renaming={element.id === renamingElementId}
              onSubmit={(changes) => onUpdateElement(element.id, changes)}
            />
          </section>

          <section className="inspector-section">
            <h3>Appearance</h3>
            <AppearanceControl element={element} onUpdateElement={onUpdateElement} />
          </section>

          <section className="inspector-section">
            <h3>Relationships</h3>
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
          </section>

          <section className="inspector-section inspector-section--datum">
            <button
              type="button"
              className="danger-button"
              onClick={() => onDeleteElement(element.id)}
            >
              Delete element
            </button>
          </section>
        </div>
      )}
    </aside>
  );
}

export function App() {
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
  const workspaceView = useMemo(() => getWorkspaceView(project, viewId), [project, viewId]);
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

  // Quick add has no pointer to aim with, so it parks the new element just clear of everything
  // already placed in this view.
  const quickAdd = useCallback(
    (entryId: string) => {
      const placements = Object.values(project.views[viewId]?.placements ?? {});
      const right =
        placements.length === 0 ? 0 : Math.max(...placements.map((place) => place.x + place.width));
      const top = placements.length === 0 ? 0 : Math.min(...placements.map((place) => place.y));
      dropPaletteEntry(entryId, {
        x: right + 80 + DEFAULT_PLACEMENT_SIZE.width / 2,
        y: top + DEFAULT_PLACEMENT_SIZE.height / 2,
      });
      // Nothing aimed this drop, so re-frame the canvas rather than leave it off-screen.
      setRevealSignal((signal) => signal + 1);
    },
    [dropPaletteEntry, project.views, viewId],
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
  }, [deleteElement, setSelection, storeApi]);

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

  const saveStatus = useAutosave(project);
  const warningCount = workspaceView.compiled.warnings.length;

  return (
    <div className="app-shell">
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
          <WorkspaceMenu status={saveStatus} />
        </div>
      </header>

      <ModelExplorer
        project={project}
        selectedElementId={selectedElementId}
        selectedViewId={viewId}
        onSelectElement={selectElement}
        onSelectView={setViewId}
        onAddPaletteEntry={quickAdd}
      />

      <main className="stage">
        <div className="stage-bar">
          <div className="stage-title">
            <div>
              <span className="panel-eyebrow">{workspaceView.compiled.type} view</span>
              <h1>{workspaceView.compiled.name}</h1>
            </div>
          </div>
          <div className="stage-tools">
            <EditorToolbar />
            <div className="segmented" role="group" aria-label="Pointer tool">
              <button
                type="button"
                aria-label="Select and move"
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

        <div className="stage-canvas">
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
              />
            </Suspense>
          )}
        </div>
      </main>

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
      />

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
