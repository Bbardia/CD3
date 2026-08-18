import type { ViewItemMove } from '@cd3/domain';

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface PlacedItem {
  readonly itemId: string;
  readonly rect: Rect;
}

function overlaps(left: Rect, right: Rect): boolean {
  return (
    left.x < right.x + right.width &&
    right.x < left.x + left.width &&
    left.y < right.y + right.height &&
    right.y < left.y + left.height
  );
}

/**
 * True when a finished drag would drop an item on top of one it is not carrying. Items dragged
 * together keep their relative spacing, so they are only tested against the ones staying put.
 */
export function movesCollide(
  moves: readonly ViewItemMove[],
  items: readonly PlacedItem[],
): boolean {
  const sizeById = new Map(items.map((item) => [item.itemId, item.rect]));
  const movedIds = new Set(moves.map((move) => move.itemId));
  const movedRects = moves.flatMap((move) => {
    const size = sizeById.get(move.itemId);
    return size === undefined ? [] : [{ ...size, x: move.x, y: move.y }];
  });
  const stationary = items.filter((item) => !movedIds.has(item.itemId));

  return movedRects.some((moved) => stationary.some((item) => overlaps(moved, item.rect)));
}
