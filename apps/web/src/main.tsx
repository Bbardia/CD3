import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { EditorStoreProvider } from './editor/EditorStoreProvider';
import './styles.css';
import { project, workspaceViewIds } from './workspace';

const rootElement = document.querySelector('#root');

if (!(rootElement instanceof HTMLElement)) {
  throw new Error('CD3 root element was not found.');
}

createRoot(rootElement).render(
  <StrictMode>
    <EditorStoreProvider initialProject={project} initialActiveViewId={workspaceViewIds[1]}>
      <App />
    </EditorStoreProvider>
  </StrictMode>,
);
