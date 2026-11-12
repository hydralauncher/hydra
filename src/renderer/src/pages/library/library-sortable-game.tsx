import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
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

interface LibrarySortableGameProps {
  orderKey: string;
  enabled: boolean;
  animated: boolean;
  isDragSource: boolean;
  style: CSSProperties;
  children: ReactNode;
}

export function LibrarySortableGame({
  orderKey,
  enabled,
  animated,
  isDragSource,
  style,
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
      style={style}
      className={cn("library-sortable-game", {
        "library-sortable-game--enabled": enabled,
        "library-sortable-game--animated": enabled && animated,
        "library-sortable-game--drag-source": enabled && isDragSource,
      })}
    >
      {children}
    </div>
  );
}
