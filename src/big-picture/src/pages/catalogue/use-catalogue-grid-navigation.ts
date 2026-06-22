import type { FocusOverrides } from "../../services";
import { BIG_PICTURE_SIDEBAR_ITEM_IDS } from "../../layout";
import { useEffect, useState } from "react";
import {
  CATALOGUE_GRID_REGION_ID,
  CATALOGUE_HEADER_CONTROLS_REGION_ID,
} from "./navigation";
import {
  type CatalogueFocusPosition,
  getActivePositionsInRegion,
  getCatalogueFocusPosition,
  getClosestPositionInDirection,
} from "./navigation-geometry";
import {
  groupItemsIntoRows,
  getClosestItemByCenterX,
} from "../../helpers/row-navigation-utils";

interface GridItemPosition extends CatalogueFocusPosition {
  top: number;
  left: number;
  centerX: number;
}

function buildFocusOverridesForGridItem(
  item: GridItemPosition,
  row: GridItemPosition[],
  itemIndex: number,
  rowIndex: number,
  rows: GridItemPosition[][],
  headerPositions: CatalogueFocusPosition[]
): FocusOverrides {
  const leftItem = row[itemIndex - 1];
  const rightItem = row[itemIndex + 1];
  const upItem = getClosestItemByCenterX(rows[rowIndex - 1], item.centerX);
  const downItem = getClosestItemByCenterX(rows[rowIndex + 1], item.centerX);
  const headerItem = getClosestPositionInDirection(item, headerPositions, "up");

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
      : { type: "block" },
  };
}

function buildOverridesMapFromRows(
  rows: GridItemPosition[][],
  headerPositions: CatalogueFocusPosition[]
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
        headerPositions
      );
    });
  });

  return nextOverridesByItemId;
}

export function useCatalogueGridNavigation(itemIds: string[]) {
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

      setOverridesByItemId(buildOverridesMapFromRows(rows, headerPositions));
    };

    function scheduleCompute() {
      globalThis.cancelAnimationFrame(animationFrameId);
      animationFrameId = globalThis.requestAnimationFrame(computeOverrides);
    }

    scheduleCompute();
    globalThis.addEventListener("resize", scheduleCompute);

    [CATALOGUE_GRID_REGION_ID, CATALOGUE_HEADER_CONTROLS_REGION_ID].forEach(
      (regionId) => {
        const element = globalThis.document.querySelector(
          `[data-focus-region-id="${regionId}"]`
        );

        if (!(element instanceof HTMLElement)) return;

        resizeObserver.observe(element);
        mutationObserver.observe(element, { childList: true, subtree: true });
      }
    );

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
  }, [itemIdsKey]);

  return overridesByItemId;
}
