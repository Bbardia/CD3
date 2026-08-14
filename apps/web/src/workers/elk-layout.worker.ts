/// <reference lib="webworker" />

import {
  layoutViewWithElk,
  type LayoutInput,
  type LayoutPreview,
  type LayoutPreviewOptions,
} from '@cd3/layout';

type WorkerRequest =
  | { readonly id: string; readonly kind: 'ping' }
  | {
      readonly id: string;
      readonly kind: 'layout';
      readonly input: LayoutInput;
      readonly options?: LayoutPreviewOptions;
    };

type WorkerResponse =
  | { readonly id: string; readonly kind: 'ready' }
  | { readonly id: string; readonly kind: 'layout'; readonly preview: LayoutPreview }
  | { readonly id: string; readonly kind: 'error'; readonly message: string };

const workerScope = globalThis as unknown as DedicatedWorkerGlobalScope;

workerScope.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (request.kind === 'ping') {
    workerScope.postMessage({ id: request.id, kind: 'ready' } satisfies WorkerResponse);
    return;
  }

  void layoutViewWithElk(request.input, request.options)
    .then((preview) => {
      workerScope.postMessage({
        id: request.id,
        kind: 'layout',
        preview,
      } satisfies WorkerResponse);
    })
    .catch((error: unknown) => {
      workerScope.postMessage({
        id: request.id,
        kind: 'error',
        message: error instanceof Error ? error.message : 'ELK worker layout failed.',
      } satisfies WorkerResponse);
    });
});

export {};
