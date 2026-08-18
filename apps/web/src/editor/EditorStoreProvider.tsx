import { createContext, useContext, useState, type PropsWithChildren } from 'react';
import type { ReadonlyProject } from '@cd3/domain';
import { useStore } from 'zustand';

import {
  createEditorStore,
  type EditorMode,
  type EditorState,
  type EditorStore,
} from './editor-store';

const EditorStoreContext = createContext<EditorStore | undefined>(undefined);

export interface EditorStoreProviderProps extends PropsWithChildren {
  readonly initialProject: ReadonlyProject;
  readonly initialActiveViewId: string;
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

/**
 * Access the read-only store handle itself, for the rare caller that must read state at an exact
 * moment rather than subscribe to it — such as reading the error a command just produced.
 */
export function useEditorStoreApi(): EditorStore {
  const store = useContext(EditorStoreContext);
  if (store === undefined) {
    throw new Error('useEditorStoreApi must be used within an EditorStoreProvider.');
  }
  return store;
}

export function useEditorStore<Selection>(selector: (state: EditorState) => Selection): Selection {
  const store = useContext(EditorStoreContext);
  if (store === undefined) {
    throw new Error('useEditorStore must be used within an EditorStoreProvider.');
  }
  return useStore(store, selector);
}
