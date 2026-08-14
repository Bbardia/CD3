interface WorkerProbeResponse {
  readonly id: string;
  readonly kind: 'error' | 'layout' | 'ready';
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
