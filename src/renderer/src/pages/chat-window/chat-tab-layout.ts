export const CHAT_TAB_MAX_WIDTH = 180;
export const CHAT_TAB_ACTIVE_MIN_WIDTH = 136;
export const CHAT_TAB_MIN_WIDTH = 40;
/** Inactive tabs narrower than this drop their name and close button. */
export const CHAT_TAB_COMPACT_WIDTH = 88;
/** Overflow button plus its left margin. */
export const CHAT_TAB_OVERFLOW_WIDTH = 44;

export interface ChatTabLayout {
  visibleIds: string[];
  hiddenIds: string[];
  activeWidth: number;
  inactiveWidth: number;
}

export function getChatTabLayout(
  ids: string[],
  activeId: string | null,
  availableWidth: number
): ChatTabLayout {
  let visibleIds = [...ids];
  let hiddenIds: string[] = [];

  const minimumWidth =
    CHAT_TAB_ACTIVE_MIN_WIDTH + (ids.length - 1) * CHAT_TAB_MIN_WIDTH;

  if (ids.length > 0 && minimumWidth > availableWidth) {
    const capacity = Math.max(
      1,
      1 +
        Math.floor(
          (availableWidth -
            CHAT_TAB_OVERFLOW_WIDTH -
            CHAT_TAB_ACTIVE_MIN_WIDTH) /
            CHAT_TAB_MIN_WIDTH
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
  const count = Math.max(visibleIds.length, 1);
  const evenWidth = Math.min(CHAT_TAB_MAX_WIDTH, Math.floor(width / count));

  if (evenWidth >= CHAT_TAB_ACTIVE_MIN_WIDTH) {
    return {
      visibleIds,
      hiddenIds,
      activeWidth: evenWidth,
      inactiveWidth: evenWidth,
    };
  }

  const inactiveWidth =
    count > 1
      ? Math.min(
          CHAT_TAB_MAX_WIDTH,
          Math.max(
            CHAT_TAB_MIN_WIDTH,
            Math.floor((width - CHAT_TAB_ACTIVE_MIN_WIDTH) / (count - 1))
          )
        )
      : 0;

  return {
    visibleIds,
    hiddenIds,
    activeWidth: CHAT_TAB_ACTIVE_MIN_WIDTH,
    inactiveWidth,
  };
}
