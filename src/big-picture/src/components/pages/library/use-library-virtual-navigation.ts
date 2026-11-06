import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import type { RefObject } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

import type { LibraryGame } from "@types";
import { NavigationService } from "../../../services";
import { useNavigationStore } from "../../../stores";
import { buildLibraryNavigationModel } from "./library-navigation-model";

interface UseLibraryVirtualNavigationParams {
  games: LibraryGame[];
  columnCount: number;
  getItemId: (gameId: string) => string;
  scrollElementRef: RefObject<HTMLElement | null>;
  anchorRef: RefObject<HTMLElement | null>;
  estimateRowHeight: number;
  rowGap: number;
  overscan?: number;
}

export function useLibraryVirtualNavigation({
  games,
  columnCount,
  getItemId,
  scrollElementRef,
  anchorRef,
  estimateRowHeight,
  rowGap,
  overscan = 6,
}: Readonly<UseLibraryVirtualNavigationParams>) {
  const navigation = NavigationService.getInstance();
  const focusedItemId = useNavigationStore((state) => state.currentFocusId);
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null);
  const [scrollMargin, setScrollMargin] = useState(0);

  const navigationModel = useMemo(
    () => buildLibraryNavigationModel(games, columnCount, getItemId),
    [columnCount, games, getItemId]
  );

  const virtualizer = useVirtualizer({
    count: navigationModel.rows.length,
    getScrollElement: () => scrollElementRef.current,
    estimateSize: () => estimateRowHeight,
    overscan,
    gap: rowGap,
    scrollMargin,
  });

  useLayoutEffect(() => {
    const scrollElement = scrollElementRef.current;
    const anchorElement = anchorRef.current;

    if (!scrollElement || !anchorElement) return;

    const updateScrollMargin = () => {
      const scrollRect = scrollElement.getBoundingClientRect();
      const anchorRect = anchorElement.getBoundingClientRect();

      setScrollMargin(
        anchorRect.top - scrollRect.top + scrollElement.scrollTop
      );
    };

    updateScrollMargin();

    const resizeObserver = new ResizeObserver(updateScrollMargin);
    resizeObserver.observe(scrollElement);
    resizeObserver.observe(anchorElement);
    globalThis.addEventListener("resize", updateScrollMargin);

    return () => {
      resizeObserver.disconnect();
      globalThis.removeEventListener("resize", updateScrollMargin);
    };
  }, [anchorRef, navigationModel.rows.length, scrollElementRef]);

  useEffect(() => {
    virtualizer.measure();
  }, [
    columnCount,
    estimateRowHeight,
    navigationModel.rows.length,
    rowGap,
    virtualizer,
  ]);

  const focusedRowIndex =
    focusedItemId !== null
      ? navigationModel.rowByItemId.get(focusedItemId)
      : undefined;
  const pendingRowIndex =
    pendingFocusId !== null
      ? navigationModel.rowByItemId.get(pendingFocusId)
      : undefined;

  const handleMissingItemFocus = useCallback(
    (itemId: string) => {
      const rowIndex = navigationModel.rowByItemId.get(itemId);

      if (rowIndex === undefined) return false;

      setPendingFocusId(itemId);
      virtualizer.scrollToIndex(rowIndex, { align: "auto" });

      return true;
    },
    [navigationModel.rowByItemId, virtualizer]
  );

  useEffect(() => {
    return navigation.setMissingItemFocusHandler(handleMissingItemFocus);
  }, [handleMissingItemFocus, navigation]);

  useEffect(() => {
    if (
      pendingFocusId !== null &&
      !navigationModel.rowByItemId.has(pendingFocusId)
    ) {
      setPendingFocusId(null);
    }
  }, [navigationModel.rowByItemId, pendingFocusId]);

  const virtualRows = virtualizer.getVirtualItems();

  const rowsToRender = useMemo(() => {
    const rowsByIndex = new Map(
      virtualRows.map((virtualRow) => [virtualRow.index, virtualRow])
    );

    for (const rowIndex of [focusedRowIndex, pendingRowIndex]) {
      if (rowIndex === undefined || rowsByIndex.has(rowIndex)) continue;

      const offset =
        virtualizer.getOffsetForIndex(rowIndex, "start")?.[0] ??
        rowIndex * (estimateRowHeight + rowGap);

      rowsByIndex.set(rowIndex, {
        index: rowIndex,
        key: rowIndex,
        start: offset,
        end: offset + estimateRowHeight,
        size: estimateRowHeight,
        lane: 0,
      });
    }

    return Array.from(rowsByIndex.values()).sort(
      (leftRow, rightRow) => leftRow.index - rightRow.index
    );
  }, [
    estimateRowHeight,
    focusedRowIndex,
    pendingRowIndex,
    rowGap,
    virtualRows,
    virtualizer,
  ]);

  const renderedRowIndexes = rowsToRender
    .map((virtualRow) => virtualRow.index)
    .join(",");

  useEffect(() => {
    if (pendingFocusId === null) return;

    const rowIndex = navigationModel.rowByItemId.get(pendingFocusId);

    if (
      rowIndex === undefined ||
      !renderedRowIndexes
        .split(",")
        .some((renderedRowIndex) => renderedRowIndex === String(rowIndex))
    ) {
      return;
    }

    const frameId = globalThis.requestAnimationFrame(() => {
      const focusedId = navigation.requestFocusWhenAvailable(pendingFocusId);

      if (focusedId) {
        setPendingFocusId(null);
      }
    });

    return () => {
      globalThis.cancelAnimationFrame(frameId);
    };
  }, [
    navigation,
    navigationModel.rowByItemId,
    pendingFocusId,
    renderedRowIndexes,
  ]);

  return {
    navigationModel,
    virtualizer,
    virtualRows: rowsToRender,
    scrollMargin,
  };
}
