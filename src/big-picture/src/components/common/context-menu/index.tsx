import "./styles.scss";

import cn from "classnames";
import { createPortal } from "react-dom";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigation, useNavigationScreenActions } from "../../../hooks";
import { FocusRegionContext } from "../../context";
import { FocusItem } from "../focus-item";
import { NavigationLayer } from "../navigation-layer";
import { VerticalFocusGroup } from "../vertical-focus-group";

const CONTEXT_MENU_VIEWPORT_PADDING = 16;
const SCROLL_LOCK_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "PageUp",
  "PageDown",
  "Home",
  "End",
  " ",
]);

export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  danger?: boolean;
  restoreFocusOnClose?: boolean;
  onSelect?: () => Promise<void> | void;
}

export interface ContextMenuProps {
  items: ContextMenuItem[];
  visible: boolean;
  position: { x: number; y: number };
  onClose: () => void;
  restoreFocusId?: string | null;
  className?: string;
  /** Localized label for the menu landmark (screen readers). */
  ariaLabel?: string;
}

export function ContextMenu({
  items,
  visible,
  position,
  onClose,
  restoreFocusId = null,
  className,
  ariaLabel = "Game context menu",
}: Readonly<ContextMenuProps>) {
  const generatedId = useId();
  const { setFocus } = useNavigation();
  const floatingRef = useRef<HTMLDivElement | null>(null);
  const [resolvedPosition, setResolvedPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);

  const menuRegionId = `context-menu-region-${generatedId.replaceAll(":", "")}`;
  const enabledItems = useMemo(
    () => items.filter((item) => !item.disabled),
    [items]
  );
  const initialFocusId = enabledItems[0]
    ? `${menuRegionId}-${enabledItems[0].id}`
    : undefined;
  const anchorPosition = position;

  const restoreFocus = useCallback(() => {
    if (!restoreFocusId) return;

    globalThis.window?.requestAnimationFrame(() => {
      setFocus(restoreFocusId);
    });
  }, [restoreFocusId, setFocus]);

  useLayoutEffect(() => {
    if (!visible || !floatingRef.current) {
      return;
    }

    const rect = floatingRef.current.getBoundingClientRect();
    const maxX =
      globalThis.window.innerWidth - rect.width - CONTEXT_MENU_VIEWPORT_PADDING;
    const maxY =
      globalThis.window.innerHeight -
      rect.height -
      CONTEXT_MENU_VIEWPORT_PADDING;

    setResolvedPosition({
      x: Math.max(
        CONTEXT_MENU_VIEWPORT_PADDING,
        Math.min(anchorPosition.x, maxX)
      ),
      y: Math.max(
        CONTEXT_MENU_VIEWPORT_PADDING,
        Math.min(anchorPosition.y, maxY)
      ),
    });
  }, [anchorPosition.x, anchorPosition.y, visible]);

  useEffect(() => {
    if (visible) return;

    setResolvedPosition(null);
  }, [visible]);

  const handleClose = useCallback(
    (shouldRestoreFocus = true) => {
      onClose();

      if (shouldRestoreFocus) {
        restoreFocus();
      }
    },
    [onClose, restoreFocus]
  );

  const handleItemSelect = useCallback(
    async (item: ContextMenuItem) => {
      if (item.disabled) return;

      await item.onSelect?.();
      handleClose(item.restoreFocusOnClose ?? true);
    },
    [handleClose]
  );

  useEffect(() => {
    if (!visible) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;

      if (!target || floatingRef.current?.contains(target)) {
        return;
      }

      handleClose(true);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        handleClose(true);
      }
    };

    globalThis.document.addEventListener("mousedown", handlePointerDown);
    globalThis.window.addEventListener("keydown", handleEscape);

    return () => {
      globalThis.document.removeEventListener("mousedown", handlePointerDown);
      globalThis.window.removeEventListener("keydown", handleEscape);
    };
  }, [floatingRef, handleClose, visible]);

  useEffect(() => {
    if (!visible) return;

    const preventScroll = (event: Event) => {
      event.preventDefault();
    };

    const preventScrollKeys = (event: KeyboardEvent) => {
      if (!SCROLL_LOCK_KEYS.has(event.key)) {
        return;
      }

      event.preventDefault();
    };

    globalThis.window.addEventListener("wheel", preventScroll, {
      passive: false,
    });
    globalThis.window.addEventListener("touchmove", preventScroll, {
      passive: false,
    });
    globalThis.window.addEventListener("keydown", preventScrollKeys);

    return () => {
      globalThis.window.removeEventListener("wheel", preventScroll);
      globalThis.window.removeEventListener("touchmove", preventScroll);
      globalThis.window.removeEventListener("keydown", preventScrollKeys);
    };
  }, [visible]);

  useNavigationScreenActions(
    visible
      ? {
          press: {
            b: () => handleClose(true),
          },
        }
      : {}
  );

  if (!visible || globalThis.document === undefined) {
    return null;
  }

  const portalTarget =
    globalThis.document.getElementById("big-picture") ??
    globalThis.document.getElementById("root") ??
    globalThis.document.body;

  return createPortal(
    <FocusRegionContext.Provider value={null}>
      <NavigationLayer
        rootRegionId={menuRegionId}
        initialFocusId={initialFocusId}
      >
        <div
          ref={floatingRef}
          className={cn("context-menu", className)}
          role="menu"
          aria-label={ariaLabel}
          style={{
            position: "fixed",
            left: resolvedPosition?.x ?? anchorPosition.x,
            top: resolvedPosition?.y ?? anchorPosition.y,
            zIndex: 1100,
            visibility: resolvedPosition ? "visible" : "hidden",
            pointerEvents: resolvedPosition ? "auto" : "none",
          }}
        >
          <VerticalFocusGroup
            regionId={menuRegionId}
            className="context-menu__list"
            style={{ gap: 0 }}
          >
            {items.map((item) => {
              const focusId = `${menuRegionId}-${item.id}`;

              return (
                <FocusItem key={item.id} id={focusId} asChild>
                  <button
                    type="button"
                    role="menuitem"
                    aria-disabled={item.disabled || undefined}
                    className={cn("context-menu__item", {
                      "context-menu__item--danger": item.danger,
                      "context-menu__item--disabled": item.disabled,
                    })}
                    onMouseEnter={() => {
                      if (!item.disabled) {
                        setFocus(focusId);
                      }
                    }}
                    onClick={() => {
                      void handleItemSelect(item);
                    }}
                  >
                    <span className="context-menu__item-main">
                      {item.icon ? (
                        <span className="context-menu__item-icon">
                          {item.icon}
                        </span>
                      ) : null}
                      <span className="context-menu__item-label">
                        {item.label}
                      </span>
                    </span>
                  </button>
                </FocusItem>
              );
            })}
          </VerticalFocusGroup>
        </div>
      </NavigationLayer>
    </FocusRegionContext.Provider>,
    portalTarget
  );
}
