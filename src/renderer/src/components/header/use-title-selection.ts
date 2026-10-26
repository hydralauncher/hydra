import { type RefObject, useEffect } from "react";

export function useTitleSelection(titleRef: RefObject<HTMLElement>) {
  useEffect(() => {
    let blockTitleSelection = false;

    const clearTitleSelection = () => {
      const title = titleRef.current;
      const selection = window.getSelection();
      if (
        title &&
        selection &&
        !selection.isCollapsed &&
        selection.rangeCount > 0 &&
        selection.getRangeAt(0).intersectsNode(title)
      ) {
        selection.removeAllRanges();
      }
    };

    const handleMouseDown = (event: MouseEvent) => {
      const startedInTitle =
        event.target instanceof Node &&
        Boolean(titleRef.current?.contains(event.target));
      blockTitleSelection = !startedInTitle && event.detail > 1;
    };

    const handleSelectionChange = () => {
      if (blockTitleSelection) clearTitleSelection();
    };

    document.addEventListener("mousedown", handleMouseDown, true);
    document.addEventListener("selectionchange", handleSelectionChange);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown, true);
      document.removeEventListener("selectionchange", handleSelectionChange);
    };
  }, [titleRef]);
}
