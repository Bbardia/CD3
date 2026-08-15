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

import type { WorkspaceViewId } from '../workspace';

export type EditorMode = '2d' | '3d';

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
  readonly lastCommandError?: CommandErrorData | undefined;

  readonly execute: (command: DomainCommand) => void;
  readonly undo: () => void;
  readonly redo: () => void;
  readonly setSelection: (
    elementIds: readonly ElementId[],
    primary?: ElementId | undefined,
  ) => void;
  readonly setActiveView: (viewId: WorkspaceViewId) => void;
  readonly setMode: (mode: EditorMode) => void;
  readonly clearError: () => void;
}

export interface CreateEditorStoreOptions {
  readonly project: ReadonlyProject;
  readonly activeViewId: WorkspaceViewId;
  readonly mode?: EditorMode;
}

export type EditorStore = StoreApi<EditorState>;

interface NormalizedSelection {
  readonly ids: readonly ElementId[];
  readonly primary: ElementId | undefined;
}

function normalizeSelection(
  elementIds: readonly ElementId[],
  primary: ElementId | undefined,
): NormalizedSelection {
  const ids: ElementId[] = [];
  const seen = new Set<ElementId>();

  for (const elementId of elementIds) {
    if (!seen.has(elementId)) {
      seen.add(elementId);
      ids.push(elementId);
    }
  }

  if (primary !== undefined && !seen.has(primary)) {
    ids.push(primary);
  }

  return {
    ids: Object.freeze(ids),
    primary: primary ?? ids[0],
  };
}

function equalIds(left: readonly ElementId[], right: readonly ElementId[]): boolean {
  return (
    left.length === right.length && left.every((elementId, index) => elementId === right[index])
  );
}

export function createEditorStore({
  project,
  activeViewId,
  mode = '2d',
}: CreateEditorStoreOptions): EditorStore {
  return createStore<EditorState>()((set) => ({
    history: createCommandHistory(project),
    selectedElementIds: Object.freeze([]),
    primarySelectedElementId: undefined,
    activeViewId,
    mode,
    lastCommandError: undefined,

    execute: (command) => {
      set((state) => {
        try {
          const history = applyCommandToHistory(state.history, command);
          if (history === state.history && state.lastCommandError === undefined) {
            return state;
          }
          return { ...state, history, lastCommandError: undefined };
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
        if (history === state.history && state.lastCommandError === undefined) {
          return state;
        }
        return { ...state, history, lastCommandError: undefined };
      });
    },
    redo: () => {
      set((state) => {
        const history = redoCommand(state.history);
        if (history === state.history && state.lastCommandError === undefined) {
          return state;
        }
        return { ...state, history, lastCommandError: undefined };
      });
    },
    setSelection: (elementIds, primary) => {
      set((state) => {
        const selection = normalizeSelection(elementIds, primary);
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
      set((state) => (state.activeViewId === viewId ? state : { ...state, activeViewId: viewId }));
    },
    setMode: (nextMode) => {
      set((state) => (state.mode === nextMode ? state : { ...state, mode: nextMode }));
    },
    clearError: () => {
      set((state) =>
        state.lastCommandError === undefined ? state : { ...state, lastCommandError: undefined },
      );
    },
  }));
}
