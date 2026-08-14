import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

const rootElement = document.querySelector('#root');

if (!(rootElement instanceof HTMLElement)) {
  throw new Error('CD3 root element was not found.');
}

createRoot(rootElement).render(<StrictMode />);
