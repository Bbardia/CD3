import {
  DomainCommandError,
  applyCommandToHistory,
  createCommandHistory,
  redoCommand,
  undoCommand,
  type CommandHistory,
  type DomainCommand,
  type DomainCommandErrorCode,
  type ElementId,
  type ReadonlyProject,
} from '@cd3/domain';
import { createStore, type StoreApi } from 'zustand/vanilla';

import { isWorkspaceViewId, type WorkspaceViewId } from '../workspace';

export type EditorMode = '2d' | '3d';
/** Pointer tool shared by both canvases: select and move, or connect two elements. */
export type EditorTool = 'connect' | 'select';

export interface CommandErrorData {
  readonly code: DomainCommandErrorCode;
  readonly message: string;
}

export interface EditorState {
  readonly history: CommandHistory;
  readonly selectedElementIds: readonly ElementId[];
  readonly primarySelectedElementId?: ElementId | undefined;
  readonly activeViewId: WorkspaceViewId;
  readonly mode: EditorMode;
  readonly tool: EditorTool;
  readonly lastCommandError?: CommandErrorData | undefined;

  readonly execute: (command: DomainCommand) => void;
  readonly undo: () => void;
  readonly redo: () => void;
  readonly setSelection: (
    elementIds: readonly ElementId[],
    primary?: ElementId | undefined,
  ) => void;
  readonly toggleSelection: (elementId: ElementId) => void;
  readonly setActiveView: (viewId: WorkspaceViewId) => void;
  readonly setMode: (mode: EditorMode) => void;
  readonly setTool: (tool: EditorTool) => void;
  readonly clearError: () => void;
}

export interface CreateEditorStoreOptions {
  readonly project: ReadonlyProject;
  readonly activeViewId: WorkspaceViewId;
  readonly mode?: EditorMode;
}

export type EditorStore = Readonly<
  Pick<StoreApi<EditorState>, 'getState' | 'getInitialState' | 'subscribe'>
>;

interface NormalizedSelection {
  readonly ids: readonly ElementId[];
  readonly primary: ElementId | undefined;
}

function normalizeSelection(
  project: ReadonlyProject,
  elementIds: readonly ElementId[],
  primary: ElementId | undefined,
): NormalizedSelection {
  const ids: ElementId[] = [];
  const seen = new Set<ElementId>();

  for (const elementId of elementIds) {
    if (
      Object.hasOwn(project.elements, elementId) &&
      project.elements[elementId] !== undefined &&
      !seen.has(elementId)
    ) {
      seen.add(elementId);
      ids.push(elementId);
    }
  }

  const validPrimary =
    primary !== undefined &&
    Object.hasOwn(project.elements, primary) &&
    project.elements[primary] !== undefined
      ? primary
      : undefined;

  if (validPrimary !== undefined && !seen.has(validPrimary)) {
    ids.push(validPrimary);
  }

  return {
    ids: Object.freeze(ids),
    primary: validPrimary ?? ids[0],
  };
}

function equalIds(left: readonly ElementId[], right: readonly ElementId[]): boolean {
  return (
    left.length === right.length && left.every((elementId, index) => elementId === right[index])
  );
}

function requireActiveView(project: ReadonlyProject, viewId: string): WorkspaceViewId {
  if (!isWorkspaceViewId(viewId)) {
    throw new RangeError(`Unsupported workspace view "${viewId}".`);
  }
  if (!Object.hasOwn(project.views, viewId) || project.views[viewId] === undefined) {
    throw new RangeError(`View "${viewId}" does not exist in project "${project.id}".`);
  }
  return viewId;
}

function updateHistory(state: EditorState, history: CommandHistory): EditorState {
  const selection = normalizeSelection(
    history.project,
    state.selectedElementIds,
    state.primarySelectedElementId,
  );
  const selectionChanged =
    selection.primary !== state.primarySelectedElementId ||
    !equalIds(selection.ids, state.selectedElementIds);

  if (history === state.history && state.lastCommandError === undefined && !selectionChanged) {
    return state;
  }
  if (!selectionChanged) {
    return { ...state, history, lastCommandError: undefined };
  }
  return {
    ...state,
    history,
    selectedElementIds: selection.ids,
    primarySelectedElementId: selection.primary,
    lastCommandError: undefined,
  };
}

export function createEditorStore({
  project,
  activeViewId,
  mode = '2d',
}: CreateEditorStoreOptions): EditorStore {
  const validatedActiveViewId = requireActiveView(project, activeViewId);

  const mutableStore = createStore<EditorState>()((set) => ({
    history: createCommandHistory(project),
    selectedElementIds: Object.freeze([]),
    primarySelectedElementId: undefined,
    activeViewId: validatedActiveViewId,
    mode,
    tool: 'select',
    lastCommandError: undefined,

    execute: (command) => {
      set((state) => {
        try {
          const history = applyCommandToHistory(state.history, command);
          return updateHistory(state, history);
        } catch (error) {
          if (!(error instanceof DomainCommandError)) {
            throw error;
          }
          if (
            state.lastCommandError?.code === error.code &&
            state.lastCommandError.message === error.message
          ) {
            return state;
          }
          return {
            ...state,
            lastCommandError: Object.freeze({ code: error.code, message: error.message }),
          };
        }
      });
    },
    undo: () => {
      set((state) => {
        const history = undoCommand(state.history);
        return updateHistory(state, history);
      });
    },
    redo: () => {
      set((state) => {
        const history = redoCommand(state.history);
        return updateHistory(state, history);
      });
    },
    setSelection: (elementIds, primary) => {
      set((state) => {
        const selection = normalizeSelection(state.history.project, elementIds, primary);
        if (
          selection.primary === state.primarySelectedElementId &&
          equalIds(selection.ids, state.selectedElementIds)
        ) {
          return state;
        }
        return {
          ...state,
          selectedElementIds: selection.ids,
          primarySelectedElementId: selection.primary,
        };
      });
    },
    toggleSelection: (elementId) => {
      set((state) => {
        const alreadySelected = state.selectedElementIds.includes(elementId);
        const nextIds = alreadySelected
          ? state.selectedElementIds.filter((candidate) => candidate !== elementId)
          : [...state.selectedElementIds, elementId];
        // Removing an element that is not primary must leave the inspector where it is; removing the
        // primary hands it to the first survivor so the panels never blank out mid-selection.
        const nextPrimary = alreadySelected
          ? state.primarySelectedElementId === elementId
            ? nextIds[0]
            : state.primarySelectedElementId
          : elementId;
        const selection = normalizeSelection(state.history.project, nextIds, nextPrimary);

        if (
          selection.primary === state.primarySelectedElementId &&
          equalIds(selection.ids, state.selectedElementIds)
        ) {
          return state;
        }
        return {
          ...state,
          selectedElementIds: selection.ids,
          primarySelectedElementId: selection.primary,
        };
      });
    },
    setActiveView: (viewId) => {
      set((state) => {
        const validatedViewId = requireActiveView(state.history.project, viewId);
        return state.activeViewId === validatedViewId
          ? state
          : { ...state, activeViewId: validatedViewId };
      });
    },
    setMode: (nextMode) => {
      set((state) => (state.mode === nextMode ? state : { ...state, mode: nextMode }));
    },
    setTool: (nextTool) => {
      set((state) => (state.tool === nextTool ? state : { ...state, tool: nextTool }));
    },
    clearError: () => {
      set((state) =>
        state.lastCommandError === undefined ? state : { ...state, lastCommandError: undefined },
      );
    },
  }));

  return Object.freeze({
    getState: mutableStore.getState,
    getInitialState: mutableStore.getInitialState,
    subscribe: mutableStore.subscribe,
  });
}
