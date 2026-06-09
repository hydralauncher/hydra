import { type CSSProperties, useEffect, useMemo, useState } from "react";
import { LIBRARY_FOCUS_GRID_REGION_ID } from "../navigation";

const GRID_NARROW_CARD_MIN_WIDTH = 260;
const GRID_NARROW_COLUMN_GAP = 24;
const GRID_STANDARD_COLUMN_GAP = 32;
const GRID_720P_WIDTH = 1280;
const GRID_1080P_WIDTH = 1920;
const GRID_1440P_WIDTH = 2560;

interface LibraryGridLayout {
  columnCount: number;
  columnGap: number;
}

function getResponsiveColumnCount(width: number) {
  if (width <= 0) return 1;

  return Math.max(
    1,
    Math.floor(
      (width + GRID_NARROW_COLUMN_GAP) /
        (GRID_NARROW_CARD_MIN_WIDTH + GRID_NARROW_COLUMN_GAP)
    )
  );
}

function getLayoutForViewport(
  viewportWidth: number,
  gridWidth: number
): LibraryGridLayout {
  if (viewportWidth >= GRID_1440P_WIDTH) {
    return {
      columnCount: 6,
      columnGap: GRID_STANDARD_COLUMN_GAP,
    };
  }

  if (viewportWidth >= GRID_1080P_WIDTH) {
    return {
      columnCount: 5,
      columnGap: GRID_STANDARD_COLUMN_GAP,
    };
  }

  if (viewportWidth >= GRID_720P_WIDTH) {
    return {
      columnCount: 4,
      columnGap: GRID_STANDARD_COLUMN_GAP,
    };
  }

  return {
    columnCount: getResponsiveColumnCount(gridWidth),
    columnGap:
      viewportWidth <= 720
        ? calcNarrowGap(viewportWidth)
        : GRID_NARROW_COLUMN_GAP,
  };
}

function calcNarrowGap(viewportWidth: number) {
  return viewportWidth <= 720 ? 16 : GRID_NARROW_COLUMN_GAP;
}

export function useLibraryGridLayout(itemCount: number) {
  const [layout, setLayout] = useState<LibraryGridLayout>({
    columnCount: 1,
    columnGap: GRID_NARROW_COLUMN_GAP,
  });

  useEffect(() => {
    if (itemCount === 0) return;

    const gridElement = globalThis.document.querySelector(
      `[data-focus-region-id="${LIBRARY_FOCUS_GRID_REGION_ID}"]`
    );

    if (!(gridElement instanceof HTMLElement)) return;

    const updateLayout = () => {
      setLayout(
        getLayoutForViewport(
          globalThis.innerWidth,
          gridElement.getBoundingClientRect().width
        )
      );
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
        "--library-focus-grid-column-count": `${layout.columnCount}`,
        "--library-focus-grid-column-gap": `${layout.columnGap}px`,
      }) as CSSProperties,
    [layout]
  );
}
