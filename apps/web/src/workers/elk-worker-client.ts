import type { LayoutInput, LayoutPreview, LayoutPreviewOptions } from '@cd3/layout/elk';

interface WorkerProbeResponse {
  readonly id: string;
  readonly kind: 'error' | 'layout' | 'ready';
}

interface WorkerLayoutResponse extends WorkerProbeResponse {
  readonly preview?: LayoutPreview;
  readonly message?: string;
}

let layoutRequestCounter = 0;

/** One worker per request keeps the client stateless; ELK layouts are rare, deliberate actions. */
export async function layoutViewInWorker(
  input: LayoutInput,
  options: LayoutPreviewOptions = {},
  timeoutMilliseconds = 15_000,
): Promise<LayoutPreview> {
  const worker = createElkLayoutWorker();
  layoutRequestCounter += 1;
  const requestId = `cd3-elk-layout-${String(layoutRequestCounter)}`;

  return await new Promise<LayoutPreview>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      worker.terminate();
      reject(new Error('The layout worker timed out.'));
    }, timeoutMilliseconds);
    worker.addEventListener('message', (event: MessageEvent<WorkerLayoutResponse>) => {
      if (event.data.id !== requestId) {
        return;
      }
      window.clearTimeout(timeout);
      worker.terminate();
      if (event.data.kind === 'layout' && event.data.preview !== undefined) {
        resolve(event.data.preview);
      } else {
        reject(new Error(event.data.message ?? 'The layout worker failed.'));
      }
    });
    worker.addEventListener(
      'error',
      () => {
        window.clearTimeout(timeout);
        worker.terminate();
        reject(new Error('The layout worker crashed.'));
      },
      { once: true },
    );
    worker.postMessage({ id: requestId, kind: 'layout', input, options });
  });
}

export function createElkLayoutWorker(): Worker {
  return new Worker(new URL('./elk-layout.worker.ts', import.meta.url), {
    name: 'cd3-elk-layout',
    type: 'module',
  });
}

export async function probeElkLayoutWorker(timeoutMilliseconds = 4_000): Promise<boolean> {
  if (typeof Worker === 'undefined') {
    return false;
  }

  let worker: Worker;
  try {
    worker = createElkLayoutWorker();
  } catch {
    return false;
  }
  const probeId = 'cd3-elk-worker-probe';

  return await new Promise<boolean>((resolve) => {
    let settled = false;
    let timeout: number | undefined;
    const finish = (ready: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeout !== undefined) {
        window.clearTimeout(timeout);
      }
      try {
        worker.terminate();
      } finally {
        resolve(ready);
      }
    };

    try {
      timeout = window.setTimeout(() => finish(false), timeoutMilliseconds);
      worker.addEventListener('message', (event: MessageEvent<WorkerProbeResponse>) => {
        if (event.data.id === probeId) {
          finish(event.data.kind === 'ready');
        }
      });
      worker.addEventListener('error', () => finish(false), { once: true });
      worker.postMessage({ id: probeId, kind: 'ping' });
    } catch {
      finish(false);
    }
  });
}
