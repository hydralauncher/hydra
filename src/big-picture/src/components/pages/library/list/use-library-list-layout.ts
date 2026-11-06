import { useLayoutEffect, useState } from "react";

import { LIBRARY_FOCUS_LIST_REGION_ID } from "../navigation";

const LIST_THREE_COLUMN_WIDTH = 1281;
const LIST_FOUR_COLUMN_WIDTH = 2240;
const LIST_TWO_COLUMN_GAP = 16;
const LIST_WIDE_COLUMN_GAP = 32;

interface LibraryListLayout {
  columnCount: number;
  columnGap: number;
  width: number;
}

function getColumnCount() {
  if (typeof globalThis.innerWidth !== "number") return 2;

  if (globalThis.innerWidth >= LIST_FOUR_COLUMN_WIDTH) return 4;
  if (globalThis.innerWidth >= LIST_THREE_COLUMN_WIDTH) return 3;

  return 2;
}

function getLayoutForViewport(): LibraryListLayout {
  const columnCount = getColumnCount();

  return {
    columnCount,
    columnGap: columnCount >= 3 ? LIST_WIDE_COLUMN_GAP : LIST_TWO_COLUMN_GAP,
    width: 0,
  };
}

function getInitialLayout(): LibraryListLayout {
  if (typeof globalThis.innerWidth !== "number") {
    return {
      columnCount: 2,
      columnGap: LIST_TWO_COLUMN_GAP,
      width: 0,
    };
  }

  return getLayoutForViewport();
}

export function useLibraryListLayout(itemCount: number) {
  const [layout, setLayout] = useState<LibraryListLayout>(getInitialLayout);

  useLayoutEffect(() => {
    if (itemCount === 0) return;

    const listElement = globalThis.document.querySelector(
      `[data-focus-region-id="${LIBRARY_FOCUS_LIST_REGION_ID}"]`
    );

    if (!(listElement instanceof HTMLElement)) return;

    const updateLayout = () => {
      const nextLayout = {
        ...getLayoutForViewport(),
        width: listElement.getBoundingClientRect().width,
      };

      setLayout((currentLayout) =>
        currentLayout.columnCount === nextLayout.columnCount &&
        currentLayout.columnGap === nextLayout.columnGap &&
        currentLayout.width === nextLayout.width
          ? currentLayout
          : nextLayout
      );
    };

    updateLayout();

    const resizeObserver = new ResizeObserver(updateLayout);
    resizeObserver.observe(listElement);
    globalThis.addEventListener("resize", updateLayout);

    return () => {
      resizeObserver.disconnect();
      globalThis.removeEventListener("resize", updateLayout);
    };
  }, [itemCount]);

  return layout;
}
