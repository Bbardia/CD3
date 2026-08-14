import { afterEach, describe, expect, it, vi } from 'vitest';

import { probeElkLayoutWorker } from './elk-worker-client';

describe('probeElkLayoutWorker', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('resolves unavailable when Worker construction throws', async () => {
    class ThrowingWorker {
      public constructor() {
        throw new Error('workers disabled');
      }
    }
    vi.stubGlobal('Worker', ThrowingWorker);

    await expect(probeElkLayoutWorker(10)).resolves.toBe(false);
  });

  it('resolves unavailable and terminates when postMessage throws', async () => {
    const terminate = vi.fn();
    class ThrowingPostMessageWorker {
      public addEventListener(): void {}

      public postMessage(): never {
        throw new Error('structured clone failed');
      }

      public terminate(): void {
        terminate();
      }
    }
    vi.stubGlobal('Worker', ThrowingPostMessageWorker);

    await expect(probeElkLayoutWorker(10)).resolves.toBe(false);
    expect(terminate).toHaveBeenCalledOnce();
  });
});
