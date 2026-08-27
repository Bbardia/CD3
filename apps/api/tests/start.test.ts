import { createServer, type AddressInfo } from 'node:net';

import { describe, expect, it } from 'vitest';

import { findFreePort } from '../src/start.js';

describe('findFreePort', () => {
  it('hops past a busy port to the next free one', async () => {
    const blocker = createServer();
    await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', resolve));
    const busy = (blocker.address() as AddressInfo).port;

    const port = await findFreePort('127.0.0.1', busy);
    expect(port).toBeGreaterThan(busy);
    expect(port).toBeLessThanOrEqual(busy + 20);

    await new Promise((resolve) => blocker.close(resolve));
  });

  it('returns a free start port unchanged', async () => {
    const probe = createServer();
    await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
    const freed = (probe.address() as AddressInfo).port;
    await new Promise((resolve) => probe.close(resolve));

    expect(await findFreePort('127.0.0.1', freed)).toBe(freed);
  });
});
