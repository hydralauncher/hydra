import { useVirtualList } from "../../../../shared/use-virtual-list";

const ESTIMATED_ROW_HEIGHT = 92;
const ESTIMATED_SET_HEADER_HEIGHT = 56;
const LIST_PADDING = 16;
const ROW_GAP = 8;

export function useVirtualAchievementList({
  count,
  scrollElement,
  getItemKey,
  isSetHeader,
}: {
  count: number;
  scrollElement: HTMLElement | null;
  getItemKey: (index: number) => string;
  isSetHeader: (index: number) => boolean;
}) {
  return useVirtualList({
    count,
    scrollElement,
    getItemKey,
    estimateSize: (index) =>
      isSetHeader(index) ? ESTIMATED_SET_HEADER_HEIGHT : ESTIMATED_ROW_HEIGHT,
    padding: LIST_PADDING,
    inset: LIST_PADDING,
    gap: ROW_GAP,
  });
}
