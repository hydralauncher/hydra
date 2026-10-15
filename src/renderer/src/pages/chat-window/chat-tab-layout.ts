export const CHAT_TAB_MAX_WIDTH = 200;
export const CHAT_TAB_MIN_WIDTH = 40;
/** Tabs narrower than this drop their name and close button, all together. */
export const CHAT_TAB_COMPACT_WIDTH = 88;
/** Space between two tabs; matches the strip's `gap` in chat-window.scss. */
export const CHAT_TAB_GAP = 4;
/** Overflow button plus its left margin. */
export const CHAT_TAB_OVERFLOW_WIDTH = 44;

export interface ChatTabLayout {
  visibleIds: string[];
  hiddenIds: string[];
  /** Width of every visible tab, whichever one is active. */
  tabWidth: number;
}

const getRowWidth = (count: number, tabWidth: number) =>
  count * tabWidth + (count - 1) * CHAT_TAB_GAP;

export function getChatTabLayout(
  ids: string[],
  activeId: string | null,
  availableWidth: number
): ChatTabLayout {
  let visibleIds = [...ids];
  let hiddenIds: string[] = [];

  if (
    ids.length > 0 &&
    getRowWidth(ids.length, CHAT_TAB_MIN_WIDTH) > availableWidth
  ) {
    const capacity = Math.max(
      1,
      Math.floor(
        (availableWidth - CHAT_TAB_OVERFLOW_WIDTH + CHAT_TAB_GAP) /
          (CHAT_TAB_MIN_WIDTH + CHAT_TAB_GAP)
      )
    );

    visibleIds = ids.slice(0, capacity);

    // The active tab always stays visible, taking over the last slot.
    if (activeId && !visibleIds.includes(activeId)) {
      visibleIds[capacity - 1] = activeId;
    }

    hiddenIds = ids.filter((id) => !visibleIds.includes(id));
  }

  const width =
    availableWidth - (hiddenIds.length > 0 ? CHAT_TAB_OVERFLOW_WIDTH : 0);
  const count = visibleIds.length;

  // Selecting a tab never resizes anything: all tabs share one width, which
  // only changes when tabs open or close or the window resizes.
  const tabWidth =
    count > 0
      ? Math.min(
          CHAT_TAB_MAX_WIDTH,
          Math.max(
            CHAT_TAB_MIN_WIDTH,
            Math.floor((width - (count - 1) * CHAT_TAB_GAP) / count)
          )
        )
      : 0;

  return { visibleIds, hiddenIds, tabWidth };
}
