import { useEffect, useRef, type ReactNode } from "react";
import { draggable } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { disableNativeDragPreview } from "@atlaskit/pragmatic-drag-and-drop/element/disable-native-drag-preview";
import cn from "classnames";
import "./library-sortable-game.scss";

export const LIBRARY_GAME_DRAG_TYPE = "library-game";

export type LibraryGameDragData = {
  type: typeof LIBRARY_GAME_DRAG_TYPE;
  orderKey: string;
};

export const isLibraryGameDragData = (
  data: Record<string | symbol, unknown>
): data is Record<string | symbol, unknown> & LibraryGameDragData =>
  data.type === LIBRARY_GAME_DRAG_TYPE && typeof data.orderKey === "string";

const SLOT_DEAD_ZONE_RATIO = 0.1;

export const findLibraryGameKeyAtPoint = (
  root: HTMLElement,
  clientX: number,
  clientY: number
): string | null => {
  for (const item of root.querySelectorAll<HTMLElement>(
    "[data-library-order-key]"
  )) {
    const row = item.offsetParent;
    if (!(row instanceof HTMLElement)) continue;

    const rowRect = row.getBoundingClientRect();
    const left = rowRect.left + item.offsetLeft;
    const top = rowRect.top + item.offsetTop;
    const insetX = item.offsetWidth * SLOT_DEAD_ZONE_RATIO;
    const insetY = item.offsetHeight * SLOT_DEAD_ZONE_RATIO;

    if (
      clientX >= left + insetX &&
      clientX <= left + item.offsetWidth - insetX &&
      clientY >= top + insetY &&
      clientY <= top + item.offsetHeight - insetY
    ) {
      return item.dataset.libraryOrderKey ?? null;
    }
  }

  return null;
};

interface LibrarySortableGameProps {
  orderKey: string;
  enabled: boolean;
  isDragSource: boolean;
  children: ReactNode;
}

export function LibrarySortableGame({
  orderKey,
  enabled,
  isDragSource,
  children,
}: Readonly<LibrarySortableGameProps>) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element || !enabled) return;

    return draggable({
      element,
      getInitialData: (): LibraryGameDragData => ({
        type: LIBRARY_GAME_DRAG_TYPE,
        orderKey,
      }),
      onGenerateDragPreview: ({ nativeSetDragImage }) =>
        disableNativeDragPreview({ nativeSetDragImage }),
    });
  }, [enabled, orderKey]);

  return (
    <div
      ref={ref}
      data-library-order-key={orderKey}
      className={cn("library-sortable-game", {
        "library-sortable-game--enabled": enabled,
        "library-sortable-game--drag-source": enabled && isDragSource,
      })}
    >
      {children}
    </div>
  );
}
