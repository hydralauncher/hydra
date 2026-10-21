import type { ScreenshotReviewRequest } from "@types";

export type ReviewDecision = "upload" | "skip" | "delete";

export interface ReviewQueueItem {
  clientId: string;
  shop: ScreenshotReviewRequest["shop"];
  gameTitle: string;
}

export interface ReviewQueueState {
  items: ReviewQueueItem[];
  index: number;
  decisions: Record<string, ReviewDecision>;
  requestCount: number;
}

export const EMPTY_REVIEW_QUEUE: ReviewQueueState = {
  items: [],
  index: 0,
  decisions: {},
  requestCount: 0,
};

export const closeReviewQueue = (
  state: ReviewQueueState
): ReviewQueueState => ({
  ...EMPTY_REVIEW_QUEUE,
  requestCount: state.requestCount,
});

export const getCurrentReviewItem = (state: ReviewQueueState) =>
  state.items[state.index] ?? null;

export const isReviewQueueOpen = (state: ReviewQueueState) =>
  state.items.length > 0;

export function enqueueReviewRequest(
  state: ReviewQueueState,
  request: Pick<ScreenshotReviewRequest, "clientIds" | "shop" | "gameTitle">
): ReviewQueueState {
  const knownIds = new Set(state.items.map((item) => item.clientId));
  const newItems: ReviewQueueItem[] = [];

  for (const clientId of request.clientIds) {
    if (knownIds.has(clientId)) continue;

    knownIds.add(clientId);
    newItems.push({
      clientId,
      shop: request.shop,
      gameTitle: request.gameTitle,
    });
  }

  if (newItems.length === 0) return state;

  return {
    ...state,
    items: [...state.items, ...newItems],
    requestCount: state.requestCount + 1,
  };
}

export function recordReviewDecision(
  state: ReviewQueueState,
  clientId: string,
  decision: ReviewDecision
): ReviewQueueState {
  return {
    ...state,
    decisions: { ...state.decisions, [clientId]: decision },
  };
}

export function advanceReviewQueue(state: ReviewQueueState): ReviewQueueState {
  if (state.index >= state.items.length - 1) return closeReviewQueue(state);

  return { ...state, index: state.index + 1 };
}

export function getUndecidedReviewIds(state: ReviewQueueState) {
  return state.items
    .filter((item) => !state.decisions[item.clientId])
    .map((item) => item.clientId);
}

export function dropMissingReviewItems(
  state: ReviewQueueState,
  availableIds: ReadonlySet<string>
): { state: ReviewQueueState; droppedIds: string[] } {
  const droppedIds: string[] = [];
  const items = state.items.filter((item, itemIndex) => {
    const isPending =
      itemIndex >= state.index && !state.decisions[item.clientId];
    if (!isPending || availableIds.has(item.clientId)) return true;

    droppedIds.push(item.clientId);
    return false;
  });

  if (droppedIds.length === 0) return { state, droppedIds };
  if (state.index >= items.length)
    return { state: closeReviewQueue(state), droppedIds };

  return { state: { ...state, items }, droppedIds };
}

export const isReviewListFresh = (
  state: ReviewQueueState,
  loadedRequestCount: number | null
) => isReviewQueueOpen(state) && loadedRequestCount === state.requestCount;
