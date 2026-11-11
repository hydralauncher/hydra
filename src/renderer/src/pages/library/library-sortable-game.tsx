import { useEffect, useRef, useState, type ReactNode } from "react";
import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import {
  draggable,
  dropTargetForElements,
} from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import cn from "classnames";
import type { LibraryDropEdge } from "./library-custom-order";
import "./library-sortable-game.scss";

export const LIBRARY_GAME_DRAG_TYPE = "library-game";

export type LibrarySortAxis = "horizontal" | "vertical";

export type LibraryGameDragData = {
  type: typeof LIBRARY_GAME_DRAG_TYPE;
  orderKey: string;
  edge?: LibraryDropEdge;
};

export const isLibraryGameDragData = (
  data: Record<string | symbol, unknown>
): data is Record<string | symbol, unknown> & LibraryGameDragData =>
  data.type === LIBRARY_GAME_DRAG_TYPE && typeof data.orderKey === "string";

const getDropEdge = (
  element: Element,
  input: { clientX: number; clientY: number },
  axis: LibrarySortAxis
): LibraryDropEdge => {
  const rect = element.getBoundingClientRect();
  const isPastMiddle =
    axis === "horizontal"
      ? input.clientX > rect.left + rect.width / 2
      : input.clientY > rect.top + rect.height / 2;
  return isPastMiddle ? "after" : "before";
};

interface LibrarySortableGameProps {
  orderKey: string;
  enabled: boolean;
  axis: LibrarySortAxis;
  children: ReactNode;
}

export function LibrarySortableGame({
  orderKey,
  enabled,
  axis,
  children,
}: Readonly<LibrarySortableGameProps>) {
  const ref = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dropEdge, setDropEdge] = useState<LibraryDropEdge | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element || !enabled) return;

    return combine(
      draggable({
        element,
        getInitialData: (): LibraryGameDragData => ({
          type: LIBRARY_GAME_DRAG_TYPE,
          orderKey,
        }),
        onDragStart: () => setIsDragging(true),
        onDrop: () => setIsDragging(false),
      }),
      dropTargetForElements({
        element,
        canDrop: ({ source }) =>
          isLibraryGameDragData(source.data) &&
          source.data.orderKey !== orderKey,
        getData: ({ input }): LibraryGameDragData => ({
          type: LIBRARY_GAME_DRAG_TYPE,
          orderKey,
          edge: getDropEdge(element, input, axis),
        }),
        onDrag: ({ self }) => {
          if (isLibraryGameDragData(self.data) && self.data.edge) {
            setDropEdge(self.data.edge);
          }
        },
        onDragLeave: () => setDropEdge(null),
        onDrop: () => setDropEdge(null),
      })
    );
  }, [enabled, orderKey, axis]);

  useEffect(() => {
    if (enabled) return;
    setIsDragging(false);
    setDropEdge(null);
  }, [enabled]);

  return (
    <div
      ref={ref}
      className={cn("library-sortable-game", {
        "library-sortable-game--enabled": enabled,
        "library-sortable-game--dragging": isDragging,
        [`library-sortable-game--drop-${axis}-${dropEdge}`]: dropEdge,
      })}
    >
      {children}
    </div>
  );
}
