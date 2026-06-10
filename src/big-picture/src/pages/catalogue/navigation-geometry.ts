import type { FocusDirection } from "../../services";

export interface CatalogueFocusPosition {
  id: string;
  rect: DOMRect;
}

function getPosition(element: HTMLElement | null) {
  if (!element) return null;

  const rect = element.getBoundingClientRect();

  if (rect.width <= 0 || rect.height <= 0) return null;

  return { id: element.id, rect };
}

export function getCatalogueFocusPosition(id: string) {
  return getPosition(globalThis.document.getElementById(id));
}

export function getActivePositionsInRegion(regionId: string) {
  const region = globalThis.document.querySelector(
    `[data-focus-region-id="${regionId}"]`
  );

  if (!(region instanceof HTMLElement)) return [];

  return Array.from(
    region.querySelectorAll<HTMLElement>(`[data-navigation-state="active"][id]`)
  )
    .map((element) => getPosition(element))
    .filter((position): position is CatalogueFocusPosition => !!position);
}

function getAxisOverlap(
  startA: number,
  endA: number,
  startB: number,
  endB: number
) {
  return Math.max(0, Math.min(endA, endB) - Math.max(startA, startB));
}

function getCenter(rect: DOMRect) {
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}

function getDirectionalScore(
  current: DOMRect,
  candidate: DOMRect,
  direction: FocusDirection
) {
  if (direction === "left" || direction === "right") {
    const primary =
      direction === "left"
        ? current.left - candidate.right
        : candidate.left - current.right;

    if (primary < 0) return null;

    return {
      overlap: getAxisOverlap(
        current.top,
        current.bottom,
        candidate.top,
        candidate.bottom
      ),
      primary,
      cross: Math.abs(getCenter(current).y - getCenter(candidate).y),
    };
  }

  const primary =
    direction === "up"
      ? current.top - candidate.bottom
      : candidate.top - current.bottom;

  if (primary < 0) return null;

  return {
    overlap: getAxisOverlap(
      current.left,
      current.right,
      candidate.left,
      candidate.right
    ),
    primary,
    cross: Math.abs(getCenter(current).x - getCenter(candidate).x),
  };
}

export function getClosestPositionInDirection(
  current: CatalogueFocusPosition,
  candidates: CatalogueFocusPosition[],
  direction: FocusDirection
) {
  return candidates
    .filter((candidate) => candidate.id !== current.id)
    .map((candidate) => ({
      candidate,
      score: getDirectionalScore(current.rect, candidate.rect, direction),
    }))
    .filter(
      (
        scored
      ): scored is {
        candidate: CatalogueFocusPosition;
        score: { overlap: number; primary: number; cross: number };
      } => scored.score !== null
    )
    .sort((left, right) => {
      if (left.score.overlap !== right.score.overlap) {
        return right.score.overlap - left.score.overlap;
      }

      if (left.score.primary !== right.score.primary) {
        return left.score.primary - right.score.primary;
      }

      return left.score.cross - right.score.cross;
    })[0]?.candidate;
}
