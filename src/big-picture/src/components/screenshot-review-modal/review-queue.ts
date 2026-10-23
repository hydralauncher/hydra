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

export const getVisibleReviewItems = (state: ReviewQueueState) =>
  state.items.filter((item) => state.decisions[item.clientId] !== "delete");

export function selectReviewItem(
  state: ReviewQueueState,
  clientId: string
): ReviewQueueState {
  const index = state.items.findIndex((item) => item.clientId === clientId);
  if (index === -1 || index === state.index) return state;
  if (state.decisions[clientId] === "delete") return state;

  return { ...state, index };
}

export function stepReviewQueue(
  state: ReviewQueueState,
  direction: -1 | 1
): ReviewQueueState {
  const visible = getVisibleReviewItems(state);
  const current = getCurrentReviewItem(state);
  const position = visible.findIndex(
    (item) => item.clientId === current?.clientId
  );
  const next = visible[position + direction];

  return next ? selectReviewItem(state, next.clientId) : state;
}

const findNextUndecidedIndex = (state: ReviewQueueState) => {
  const isUndecided = (index: number) => {
    const item = state.items[index];
    return Boolean(item) && !state.decisions[item.clientId];
  };

  for (let index = state.index + 1; index < state.items.length; index += 1) {
    if (isUndecided(index)) return index;
  }
  for (let index = 0; index < state.index; index += 1) {
    if (isUndecided(index)) return index;
  }
  return -1;
};

export const hasOtherUndecidedReviewItems = (state: ReviewQueueState) =>
  findNextUndecidedIndex(state) !== -1;

export function advanceReviewQueuePast(
  state: ReviewQueueState,
  clientId: string
): ReviewQueueState {
  if (getCurrentReviewItem(state)?.clientId !== clientId) return state;

  const nextIndex = findNextUndecidedIndex(state);
  if (nextIndex === -1) return closeReviewQueue(state);

  return { ...state, index: nextIndex };
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
