import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { draggable } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { disableNativeDragPreview } from "@atlaskit/pragmatic-drag-and-drop/element/disable-native-drag-preview";
import { useTranslation } from "react-i18next";
import cn from "classnames";
import {
  DEFAULT_LIBRARY_CARD_SIZE,
  LIBRARY_MAX_CARD_ROWS,
  type LibraryCardSize,
  type LibraryGridMetrics,
} from "./library-grid-layout";
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

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const RESIZE_KEY_STEPS: Record<string, Partial<LibraryCardSize>> = {
  ArrowRight: { columns: 1 },
  ArrowLeft: { columns: -1 },
  ArrowDown: { rows: 1 },
  ArrowUp: { rows: -1 },
};

type ResizeAxis = "columns" | "rows" | "both";

const RESIZE_EDGES: { axis: ResizeAxis; className: string }[] = [
  { axis: "columns", className: "library-sortable-game__edge--right" },
  { axis: "rows", className: "library-sortable-game__edge--bottom" },
];

interface ResizeSession {
  axis: ResizeAxis;
  pointerId: number;
  startX: number;
  startY: number;
  startSize: LibraryCardSize;
}

interface LibrarySortableGameProps {
  orderKey: string;
  enabled: boolean;
  isDragSource: boolean;
  style: CSSProperties;
  size: LibraryCardSize;
  maxColumns: number;
  metrics: LibraryGridMetrics;
  onResize: (orderKey: string, size: LibraryCardSize) => void;
  children: ReactNode;
}

export function LibrarySortableGame({
  orderKey,
  enabled,
  isDragSource,
  style,
  size,
  maxColumns,
  metrics,
  onResize,
  children,
}: Readonly<LibrarySortableGameProps>) {
  const { t } = useTranslation("library");
  const ref = useRef<HTMLDivElement>(null);
  const resizeRef = useRef<ResizeSession | null>(null);
  const [isResizing, setIsResizing] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element || !enabled) return;

    return draggable({
      element,
      canDrag: () => resizeRef.current === null,
      getInitialData: (): LibraryGameDragData => ({
        type: LIBRARY_GAME_DRAG_TYPE,
        orderKey,
      }),
      onGenerateDragPreview: ({ nativeSetDragImage }) =>
        disableNativeDragPreview({ nativeSetDragImage }),
    });
  }, [enabled, orderKey]);

  const applySize = (next: LibraryCardSize) => {
    const bounded = {
      columns: clamp(next.columns, 1, maxColumns),
      rows: clamp(next.rows, 1, LIBRARY_MAX_CARD_ROWS),
    };
    if (bounded.columns !== size.columns || bounded.rows !== size.rows) {
      onResize(orderKey, bounded);
    }
  };

  const endResize = (event: PointerEvent<HTMLElement>) => {
    const session = resizeRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    resizeRef.current = null;
    setIsResizing(false);
  };

  const startResize = (event: PointerEvent<HTMLElement>, axis: ResizeAxis) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeRef.current = {
      axis,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startSize: size,
    };
    setIsResizing(true);
  };

  const handleResizePointerMove = (event: PointerEvent<HTMLElement>) => {
    const session = resizeRef.current;
    if (!session || session.pointerId !== event.pointerId) return;

    const columnDelta = Math.round(
      (event.clientX - session.startX) / (metrics.cellWidth + metrics.gap)
    );
    const rowDelta = Math.round(
      (event.clientY - session.startY) / (metrics.cellHeight + metrics.gap)
    );
    applySize({
      columns:
        session.startSize.columns + (session.axis === "rows" ? 0 : columnDelta),
      rows:
        session.startSize.rows + (session.axis === "columns" ? 0 : rowDelta),
    });
  };

  const getResizeHandlers = (axis: ResizeAxis) => ({
    onMouseDown: (event: MouseEvent<HTMLElement>) => {
      event.preventDefault();
      event.stopPropagation();
    },
    onPointerDown: (event: PointerEvent<HTMLElement>) =>
      startResize(event, axis),
    onPointerMove: handleResizePointerMove,
    onPointerUp: endResize,
    onPointerCancel: endResize,
    onDoubleClick: () => applySize(DEFAULT_LIBRARY_CARD_SIZE),
    onClick: (event: MouseEvent<HTMLElement>) => event.stopPropagation(),
    onContextMenu: (event: MouseEvent<HTMLElement>) => event.stopPropagation(),
  });

  const handleResizeKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const step = RESIZE_KEY_STEPS[event.key];
    if (!step) return;
    event.preventDefault();
    applySize({
      columns: size.columns + (step.columns ?? 0),
      rows: size.rows + (step.rows ?? 0),
    });
  };

  return (
    <div
      ref={ref}
      data-library-order-key={orderKey}
      style={style}
      className={cn("library-sortable-game", {
        "library-sortable-game--enabled": enabled,
        "library-sortable-game--drag-source": enabled && isDragSource,
        "library-sortable-game--resizing": isResizing,
      })}
    >
      {children}

      {enabled &&
        RESIZE_EDGES.map(({ axis, className }) => (
          <span
            key={axis}
            aria-hidden="true"
            className={cn("library-sortable-game__edge", className)}
            {...getResizeHandlers(axis)}
          />
        ))}

      {enabled && (
        <button
          type="button"
          className="library-sortable-game__edge library-sortable-game__edge--corner"
          aria-label={t("resize_card")}
          title={t("resize_card")}
          onKeyDown={handleResizeKeyDown}
          {...getResizeHandlers("both")}
        />
      )}

      {isResizing && (
        <span className="library-sortable-game__size-label">
          {`${size.columns} × ${size.rows}`}
        </span>
      )}
    </div>
  );
}
