import type { FocusOverrides } from "../../services";
import { BIG_PICTURE_SIDEBAR_ITEM_IDS } from "../../layout";
import { useEffect, useState } from "react";
import { useNavigationStore } from "../../stores";
import {
  CATALOGUE_FILTERS_REGION_ID,
  CATALOGUE_GRID_REGION_ID,
  CATALOGUE_HEADER_CONTROLS_REGION_ID,
  CATALOGUE_PAGINATION_REGION_ID,
  getCatalogueFilterRegionId,
} from "./navigation";
import {
  type CatalogueFocusPosition,
  getActivePositionsInRegion,
  getCatalogueFocusPosition,
  getClosestPositionInDirection,
} from "./navigation-geometry";
import { FilterType } from "./use-catalogue-data";

interface GridItemPosition extends CatalogueFocusPosition {
  top: number;
  left: number;
  centerX: number;
}

const ROW_TOLERANCE_PX = 24;
const SIDEBAR_REGION_IDS = new Set(
  Object.values(FilterType).map((filterKey) =>
    getCatalogueFilterRegionId(filterKey)
  )
);

function groupItemsIntoRows(items: GridItemPosition[]) {
  const sortedItems = [...items].sort((leftItem, rightItem) => {
    if (Math.abs(leftItem.top - rightItem.top) > ROW_TOLERANCE_PX) {
      return leftItem.top - rightItem.top;
    }

    return leftItem.left - rightItem.left;
  });

  return sortedItems.reduce<GridItemPosition[][]>((rows, item) => {
    const lastRow = rows.at(-1);

    if (!lastRow || Math.abs(lastRow[0].top - item.top) > ROW_TOLERANCE_PX) {
      rows.push([item]);
      return rows;
    }

    lastRow.push(item);
    lastRow.sort((leftItem, rightItem) => leftItem.left - rightItem.left);
    return rows;
  }, []);
}

function getClosestItemByCenterX(
  items: GridItemPosition[] | undefined,
  centerX: number
) {
  if (!items?.length) return null;

  return [...items].sort((leftItem, rightItem) => {
    return (
      Math.abs(leftItem.centerX - centerX) -
      Math.abs(rightItem.centerX - centerX)
    );
  })[0];
}

function buildFocusOverridesForGridItem(
  item: GridItemPosition,
  row: GridItemPosition[],
  itemIndex: number,
  rowIndex: number,
  rows: GridItemPosition[][],
  headerPositions: CatalogueFocusPosition[],
  sidebarPositions: CatalogueFocusPosition[],
  paginationPositions: CatalogueFocusPosition[]
): FocusOverrides {
  const leftItem = row[itemIndex - 1];
  const rightItem = row[itemIndex + 1];
  const upItem = getClosestItemByCenterX(rows[rowIndex - 1], item.centerX);
  const downItem = getClosestItemByCenterX(rows[rowIndex + 1], item.centerX);
  const headerItem = getClosestPositionInDirection(item, headerPositions, "up");
  const sidebarItem = getClosestPositionInDirection(
    item,
    sidebarPositions,
    "right"
  );
  const paginationItem = getClosestPositionInDirection(
    item,
    paginationPositions,
    "down"
  );

  return {
    left: leftItem
      ? {
          type: "item",
          itemId: leftItem.id,
        }
      : {
          type: "item",
          itemId: BIG_PICTURE_SIDEBAR_ITEM_IDS.catalogue,
        },
    right: rightItem
      ? {
          type: "item",
          itemId: rightItem.id,
        }
      : sidebarItem
        ? {
            type: "region",
            regionId: sidebarItem.id,
            entryDirection: "right",
            preferRememberedFocus: true,
          }
        : { type: "block" },
    up: upItem
      ? {
          type: "item",
          itemId: upItem.id,
        }
      : headerItem
        ? {
            type: "item",
            itemId: headerItem.id,
          }
        : { type: "block" },
    down: downItem
      ? {
          type: "item",
          itemId: downItem.id,
        }
      : paginationItem
        ? {
            type: "item",
            itemId: paginationItem.id,
          }
        : { type: "block" },
  };
}

function buildOverridesMapFromRows(
  rows: GridItemPosition[][],
  headerPositions: CatalogueFocusPosition[],
  sidebarPositions: CatalogueFocusPosition[],
  paginationPositions: CatalogueFocusPosition[]
) {
  const nextOverridesByItemId: Record<string, FocusOverrides> = {};

  rows.forEach((row, rowIndex) => {
    row.forEach((item, itemIndex) => {
      nextOverridesByItemId[item.id] = buildFocusOverridesForGridItem(
        item,
        row,
        itemIndex,
        rowIndex,
        rows,
        headerPositions,
        sidebarPositions,
        paginationPositions
      );
    });
  });

  return nextOverridesByItemId;
}

export function useCatalogueGridNavigation(itemIds: string[]) {
  const navigationRegions = useNavigationStore((state) => state.regions);
  const [overridesByItemId, setOverridesByItemId] = useState<
    Record<string, FocusOverrides>
  >({});
  const itemIdsKey = itemIds.join("\u0000");

  useEffect(() => {
    const ids = itemIdsKey ? itemIdsKey.split("\u0000") : [];

    if (ids.length === 0) {
      setOverridesByItemId({});
      return;
    }

    let animationFrameId = 0;
    const resizeObserver = new ResizeObserver(() => scheduleCompute());
    const mutationObserver = new MutationObserver(() => scheduleCompute());

    const computeOverrides = () => {
      const items = ids
        .map((id) => getCatalogueFocusPosition(id))
        .filter((position) => !!position)
        .map((position) => ({
          ...position,
          top: position.rect.top,
          left: position.rect.left,
          centerX: position.rect.left + position.rect.width / 2,
        }));
      const rows = groupItemsIntoRows(items);
      const headerPositions = getActivePositionsInRegion(
        CATALOGUE_HEADER_CONTROLS_REGION_ID
      );
      const sidebarPositions = navigationRegions
        .filter(
          (region) =>
            region.parentRegionId === CATALOGUE_FILTERS_REGION_ID &&
            SIDEBAR_REGION_IDS.has(region.id)
        )
        .map((region) => {
          const rect = region.getElement()?.getBoundingClientRect();

          if (!rect || rect.width <= 0 || rect.height <= 0) return null;

          return {
            id: region.id,
            rect,
          };
        })
        .filter(
          (position): position is CatalogueFocusPosition => position !== null
        );
      const paginationPositions = getActivePositionsInRegion(
        CATALOGUE_PAGINATION_REGION_ID
      );

      setOverridesByItemId(
        buildOverridesMapFromRows(
          rows,
          headerPositions,
          sidebarPositions,
          paginationPositions
        )
      );
    };

    function scheduleCompute() {
      globalThis.cancelAnimationFrame(animationFrameId);
      animationFrameId = globalThis.requestAnimationFrame(computeOverrides);
    }

    scheduleCompute();
    globalThis.addEventListener("resize", scheduleCompute);

    [
      CATALOGUE_GRID_REGION_ID,
      CATALOGUE_HEADER_CONTROLS_REGION_ID,
      CATALOGUE_FILTERS_REGION_ID,
      CATALOGUE_PAGINATION_REGION_ID,
    ].forEach((regionId) => {
      const element = globalThis.document.querySelector(
        `[data-focus-region-id="${regionId}"]`
      );

      if (!(element instanceof HTMLElement)) return;

      resizeObserver.observe(element);
      mutationObserver.observe(element, { childList: true, subtree: true });
    });

    ids.forEach((id) => {
      const element = globalThis.document.getElementById(id);

      if (element) {
        resizeObserver.observe(element);
      }
    });

    return () => {
      globalThis.cancelAnimationFrame(animationFrameId);
      globalThis.removeEventListener("resize", scheduleCompute);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, [itemIdsKey, navigationRegions]);

  return overridesByItemId;
}
