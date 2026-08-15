import { createContext, useContext, useState, type PropsWithChildren } from 'react';
import type { ReadonlyProject } from '@cd3/domain';
import { useStore } from 'zustand';

import {
  createEditorStore,
  type EditorMode,
  type EditorState,
  type EditorStore,
} from './editor-store';
import type { WorkspaceViewId } from '../workspace';

const EditorStoreContext = createContext<EditorStore | undefined>(undefined);

export interface EditorStoreProviderProps extends PropsWithChildren {
  readonly initialProject: ReadonlyProject;
  readonly initialActiveViewId: WorkspaceViewId;
  readonly initialMode?: EditorMode;
}

export function EditorStoreProvider({
  children,
  initialProject,
  initialActiveViewId,
  initialMode,
}: EditorStoreProviderProps) {
  const [store] = useState(() =>
    createEditorStore({
      project: initialProject,
      activeViewId: initialActiveViewId,
      ...(initialMode === undefined ? {} : { mode: initialMode }),
    }),
  );

  return <EditorStoreContext.Provider value={store}>{children}</EditorStoreContext.Provider>;
}

export function useEditorStore<Selection>(selector: (state: EditorState) => Selection): Selection {
  const store = useContext(EditorStoreContext);
  if (store === undefined) {
    throw new Error('useEditorStore must be used within an EditorStoreProvider.');
  }
  return useStore(store, selector);
}
