import { describe, expect, it } from 'vitest';

import { centerSnap, movesCollide } from './placement';

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

describe('centerSnap', () => {
  const neighbour = { x: 200, y: 200, width: 100, height: 50 }; // centre (250, 225)

  it('locks a nearby centre onto the neighbour centre and reports the guide', () => {
    // Dragged centre (245, 100): 5 off on x, far off on y.
    const snap = centerSnap({ x: 195, y: 75, width: 100, height: 50 }, [neighbour]);
    expect(snap.dx).toBe(5);
    expect(snap.dy).toBe(0);
    expect(snap.guides).toEqual([{ axis: 'x', position: 250, start: 75 - 12, end: 250 + 12 }]);
  });

  it('does not snap once the centres drift past the threshold', () => {
    const snap = centerSnap({ x: 195, y: 75, width: 100, height: 50 }, [neighbour], 4);
    expect(snap).toEqual({ dx: 0, dy: 0, guides: [] });
  });

  it('snaps both axes at once, picking the closest neighbour per axis', () => {
    const far = { x: 0, y: 193, width: 100, height: 50 }; // centre (50, 218): 7 off on y
    // Dragged centre (247, 222): 3 off x of `neighbour`, 3 off y of `neighbour`, 4 off y of `far`.
    const snap = centerSnap({ x: 197, y: 197, width: 100, height: 50 }, [neighbour, far]);
    expect(snap.dx).toBe(3);
    expect(snap.dy).toBe(3);
    expect(snap.guides.map((guide) => guide.axis)).toEqual(['x', 'y']);
  });
});
