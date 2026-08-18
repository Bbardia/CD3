import { describe, expect, it } from 'vitest';

import { movesCollide } from './placement';

const items = [
  { itemId: 'a', rect: { x: 0, y: 0, width: 100, height: 50 } },
  { itemId: 'b', rect: { x: 200, y: 0, width: 100, height: 50 } },
  { itemId: 'c', rect: { x: 400, y: 0, width: 100, height: 50 } },
];

describe('movesCollide', () => {
  it('rejects a drop that lands on a block that is staying put', () => {
    expect(movesCollide([{ itemId: 'a', x: 250, y: 20 }], items)).toBe(true);
  });

  it('accepts a drop into free space, including edge-to-edge contact', () => {
    expect(movesCollide([{ itemId: 'a', x: 100, y: 0 }], items)).toBe(false);
    expect(movesCollide([{ itemId: 'a', x: 0, y: 200 }], items)).toBe(false);
  });

  it('ignores collisions between blocks dragged together, which keep their spacing', () => {
    expect(
      movesCollide(
        [
          { itemId: 'a', x: 600, y: 0 },
          { itemId: 'b', x: 620, y: 0 },
        ],
        items,
      ),
    ).toBe(false);
  });

  it('still sees the blocks that were left behind by a group drag', () => {
    expect(
      movesCollide(
        [
          { itemId: 'a', x: 400, y: 0 },
          { itemId: 'b', x: 700, y: 0 },
        ],
        items,
      ),
    ).toBe(true);
  });
});
