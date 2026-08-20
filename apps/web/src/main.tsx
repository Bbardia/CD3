import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { EditorStoreProvider } from './editor/EditorStoreProvider';
import { loadProject } from './editor/persistence';
import './styles.css';
import { project, workspaceViewIdsOf } from './workspace';

const rootElement = document.querySelector('#root');

if (!(rootElement instanceof HTMLElement)) {
  throw new Error('CD3 root element was not found.');
}

// The saved snapshot decides what the app opens with, so the first paint is already the real
// project rather than the sample flashing before it is replaced.
void loadProject(project).then((loaded) => {
  const viewIds = workspaceViewIdsOf(loaded.project);
  createRoot(rootElement).render(
    <StrictMode>
      <EditorStoreProvider
        initialProject={loaded.project}
        initialActiveViewId={viewIds[1] ?? viewIds[0] ?? ''}
      >
        <App initialProjectSource={loaded.source} />
      </EditorStoreProvider>
    </StrictMode>,
  );
});
