export const SCREENSHOT_MIN_VISIBLE_WHEN_FILTERED = 12;
export const SCREENSHOT_MAX_HIDDEN_PAGES_PER_REQUEST = 5;

export interface ScreenshotSpoilerPagingState {
  loadedCount: number;
  visibleCount: number;
  hiddenPageStreak: number;
}

export const INITIAL_SCREENSHOT_SPOILER_PAGING: ScreenshotSpoilerPagingState = {
  loadedCount: 0,
  visibleCount: 0,
  hiddenPageStreak: 0,
};

export const trackSpoilerPaging = (
  state: ScreenshotSpoilerPagingState,
  loadedCount: number,
  visibleCount: number
): ScreenshotSpoilerPagingState => {
  if (loadedCount < state.loadedCount) {
    return { loadedCount, visibleCount, hiddenPageStreak: 0 };
  }
  if (loadedCount === state.loadedCount) {
    return { ...state, visibleCount };
  }

  return {
    loadedCount,
    visibleCount,
    hiddenPageStreak:
      visibleCount > state.visibleCount ? 0 : state.hiddenPageStreak + 1,
  };
};

export const resumeSpoilerPaging = (
  state: ScreenshotSpoilerPagingState
): ScreenshotSpoilerPagingState => ({ ...state, hiddenPageStreak: 0 });

interface SpoilerAutoLoadInput {
  hideSpoilers: boolean;
  canLoadMore: boolean;
  paging: ScreenshotSpoilerPagingState;
}

export const isSpoilerPagingPaused = ({
  hideSpoilers,
  canLoadMore,
  paging,
}: SpoilerAutoLoadInput) =>
  hideSpoilers &&
  canLoadMore &&
  paging.hiddenPageStreak >= SCREENSHOT_MAX_HIDDEN_PAGES_PER_REQUEST;

export const shouldAutoLoadSpoilerPage = (input: SpoilerAutoLoadInput) => {
  const { hideSpoilers, canLoadMore, paging } = input;
  if (!hideSpoilers || !canLoadMore || isSpoilerPagingPaused(input)) {
    return false;
  }

  return (
    paging.visibleCount < SCREENSHOT_MIN_VISIBLE_WHEN_FILTERED ||
    paging.hiddenPageStreak > 0
  );
};
