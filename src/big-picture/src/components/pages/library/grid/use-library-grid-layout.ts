import { type CSSProperties, useEffect, useMemo, useState } from "react";
import { LIBRARY_FOCUS_GRID_REGION_ID } from "../navigation";

const GRID_CARD_WIDTH = 350;
const GRID_MIN_COLUMN_GAP = 32;
const GRID_MOBILE_BREAKPOINT = 720;

interface LibraryGridLayout {
  columnCount: number;
  columnGap: number;
}

function getLayoutForWidth(width: number): LibraryGridLayout {
  if (width <= 0) {
    return {
      columnCount: 1,
      columnGap: GRID_MIN_COLUMN_GAP,
    };
  }

  const columnCount = Math.max(
    1,
    Math.floor(
      (width + GRID_MIN_COLUMN_GAP) / (GRID_CARD_WIDTH + GRID_MIN_COLUMN_GAP)
    )
  );

  return {
    columnCount,
    columnGap:
      columnCount > 1
        ? Math.max(
            GRID_MIN_COLUMN_GAP,
            (width - columnCount * GRID_CARD_WIDTH) / (columnCount - 1)
          )
        : GRID_MIN_COLUMN_GAP,
  };
}

export function useLibraryGridLayout(itemCount: number) {
  const [layout, setLayout] = useState(() => getLayoutForWidth(0));

  useEffect(() => {
    if (itemCount === 0) return;

    const gridElement = globalThis.document.querySelector(
      `[data-focus-region-id="${LIBRARY_FOCUS_GRID_REGION_ID}"]`
    );

    if (!(gridElement instanceof HTMLElement)) return;

    const updateLayout = () => {
      if (globalThis.innerWidth <= GRID_MOBILE_BREAKPOINT) {
        setLayout(getLayoutForWidth(0));
        return;
      }

      setLayout(getLayoutForWidth(gridElement.getBoundingClientRect().width));
    };

    updateLayout();

    const resizeObserver = new ResizeObserver(updateLayout);
    resizeObserver.observe(gridElement);
    globalThis.addEventListener("resize", updateLayout);

    return () => {
      resizeObserver.disconnect();
      globalThis.removeEventListener("resize", updateLayout);
    };
  }, [itemCount]);

  return useMemo(
    () =>
      ({
        "--library-focus-grid-card-width": `${GRID_CARD_WIDTH}px`,
        "--library-focus-grid-column-count": `${layout.columnCount}`,
        "--library-focus-grid-column-gap": `${layout.columnGap}px`,
      }) as CSSProperties,
    [layout]
  );
}
