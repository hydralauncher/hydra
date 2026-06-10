import "./styles.scss";

import cn from "classnames";
import { AnimatePresence, motion } from "framer-motion";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { IS_BROWSER } from "../../../constants";
import { useNavigationScreenActions } from "../../../hooks";
import { useVirtualKeyboardStore } from "../../../stores";
import { FocusRegionContext } from "../../context";
import { Backdrop } from "../backdrop";
import { FocusItem } from "../focus-item";
import { NavigationLayer } from "../navigation-layer";
import { VerticalFocusGroup } from "../vertical-focus-group";
import { MODAL_OWNED_OVERLAY_ATTRIBUTE } from "../modal";

export interface SidebarModalTab {
  id: string;
  label: ReactNode;
  content: ReactNode;
  disabled?: boolean;
}

export interface SidebarModalProps {
  visible: boolean;
  onClose: () => void;
  title: ReactNode;
  tabs: SidebarModalTab[];
  activeTabId?: string;
  defaultActiveTabId?: string;
  onActiveTabChange?: (tabId: string) => void;
  contentEntryFocusId?: string;
  className?: string;
  ariaLabel?: string;
  closeOnBackdrop?: boolean;
  closeOnEscape?: boolean;
  closeOnB?: boolean;
}

function normalizeIdSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function getFirstEnabledTab(tabs: SidebarModalTab[]) {
  return tabs.find((tab) => !tab.disabled) ?? tabs[0] ?? null;
}

interface ActiveTabMetrics {
  top: number;
  height: number;
}

export function SidebarModal({
  visible,
  onClose,
  title,
  tabs,
  activeTabId,
  defaultActiveTabId,
  onActiveTabChange,
  contentEntryFocusId,
  className,
  ariaLabel,
  closeOnBackdrop = true,
  closeOnEscape = true,
  closeOnB = true,
}: Readonly<SidebarModalProps>) {
  const generatedId = useId().replaceAll(":", "");
  const modalContentRef = useRef<HTMLDivElement | null>(null);
  const tabElementsRef = useRef<Record<string, HTMLButtonElement | null>>({});
  const firstEnabledTab = useMemo(() => getFirstEnabledTab(tabs), [tabs]);
  const initialTabId =
    defaultActiveTabId ?? activeTabId ?? firstEnabledTab?.id ?? "";
  const [internalActiveTabId, setInternalActiveTabId] = useState(initialTabId);
  const [activeTabMetrics, setActiveTabMetrics] =
    useState<ActiveTabMetrics | null>(null);
  const [highlightedTabId, setHighlightedTabId] = useState<string | null>(null);
  const virtualKeyboardTarget = useVirtualKeyboardStore(
    (state) => state.target
  );
  const resolvedActiveTabId = activeTabId ?? internalActiveTabId;
  const activeTab =
    tabs.find((tab) => tab.id === resolvedActiveTabId && !tab.disabled) ??
    firstEnabledTab;
  const modalId = `sidebar-modal-${generatedId}`;
  const tabsRegionId = `${modalId}-tabs`;
  const contentRegionId = `${modalId}-content`;
  const getTabFocusId = useCallback(
    (tabId: string) =>
      `${modalId}-tab-${normalizeIdSegment(tabId || "untitled")}`,
    [modalId]
  );
  const activeTabFocusId = activeTab ? getTabFocusId(activeTab.id) : undefined;
  const isVirtualKeyboardOpen = virtualKeyboardTarget !== null;

  const isTopMostModal = () => {
    const openModals = document.querySelectorAll("[role=dialog]");
    return (
      openModals.length &&
      openModals[openModals.length - 1] === modalContentRef.current
    );
  };

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  const setActiveTab = useCallback(
    (tabId: string) => {
      if (activeTabId === undefined) {
        setInternalActiveTabId(tabId);
      }

      onActiveTabChange?.(tabId);
    },
    [activeTabId, onActiveTabChange]
  );

  const clearHighlightedTab = useCallback((tabId: string) => {
    setHighlightedTabId((currentTabId) =>
      currentTabId === tabId ? null : currentTabId
    );
  }, []);

  const updateActiveTabMetrics = useCallback(() => {
    if (!visible || !activeTab) {
      setActiveTabMetrics(null);
      return;
    }

    const activeTabElement = tabElementsRef.current[activeTab.id];

    if (!activeTabElement) {
      setActiveTabMetrics(null);
      return;
    }

    const nextMetrics = {
      top: activeTabElement.offsetTop,
      height: activeTabElement.offsetHeight,
    };

    setActiveTabMetrics((currentMetrics) => {
      if (
        currentMetrics?.top === nextMetrics.top &&
        currentMetrics.height === nextMetrics.height
      ) {
        return currentMetrics;
      }

      return nextMetrics;
    });
  }, [activeTab, visible]);

  useEffect(() => {
    if (!visible || !firstEnabledTab) return;

    const hasActiveVisibleTab = tabs.some(
      (tab) => tab.id === resolvedActiveTabId && !tab.disabled
    );

    if (!hasActiveVisibleTab) {
      setActiveTab(firstEnabledTab.id);
    }
  }, [firstEnabledTab, resolvedActiveTabId, setActiveTab, tabs, visible]);

  useLayoutEffect(() => {
    updateActiveTabMetrics();
  }, [tabs, updateActiveTabMetrics]);

  useEffect(() => {
    if (!visible) return;

    const activeTabElement = activeTab
      ? tabElementsRef.current[activeTab.id]
      : null;
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(updateActiveTabMetrics);
    const animationFrameId = globalThis.requestAnimationFrame(
      updateActiveTabMetrics
    );

    if (modalContentRef.current) {
      resizeObserver?.observe(modalContentRef.current);
    }

    if (activeTabElement) {
      resizeObserver?.observe(activeTabElement);
    }

    globalThis.window.addEventListener("resize", updateActiveTabMetrics);

    return () => {
      globalThis.cancelAnimationFrame(animationFrameId);
      resizeObserver?.disconnect();
      globalThis.window.removeEventListener("resize", updateActiveTabMetrics);
    };
  }, [activeTab, updateActiveTabMetrics, visible]);

  useNavigationScreenActions(
    visible && closeOnB && !isVirtualKeyboardOpen
      ? {
          press: {
            b: () => {
              if (!isTopMostModal()) return;
              handleClose();
            },
          },
        }
      : {}
  );

  useEffect(() => {
    if (!visible || !closeOnEscape) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (event.defaultPrevented) return;
      if (useVirtualKeyboardStore.getState().target !== null) return;
      if (!isTopMostModal()) return;

      handleClose();
    };

    globalThis.window.addEventListener("keydown", onKeyDown);
    return () => globalThis.window.removeEventListener("keydown", onKeyDown);
  }, [closeOnEscape, handleClose, visible]);

  useEffect(() => {
    if (!visible || !closeOnBackdrop) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!isTopMostModal()) return;

      const target = event.target as Node | null;
      const targetElement = target instanceof Element ? target : null;
      const clickedOwnedOverlay = targetElement?.closest(
        `[${MODAL_OWNED_OVERLAY_ATTRIBUTE}]`
      );
      const clickedOutside =
        modalContentRef.current &&
        target &&
        !modalContentRef.current.contains(target) &&
        !clickedOwnedOverlay;

      if (clickedOutside) {
        handleClose();
      }
    };

    globalThis.window.addEventListener("pointerdown", onPointerDown, true);
    return () =>
      globalThis.window.removeEventListener("pointerdown", onPointerDown, true);
  }, [closeOnBackdrop, handleClose, visible]);

  if (!IS_BROWSER) return null;

  const portalTarget =
    document.getElementById("big-picture") ??
    document.getElementById("root") ??
    document.body;

  return createPortal(
    <FocusRegionContext.Provider value={null}>
      <AnimatePresence>
        {visible && (
          <Backdrop>
            <motion.aside
              id={modalId}
              role="dialog"
              aria-modal="true"
              aria-label={ariaLabel ?? String(title)}
              ref={modalContentRef}
              data-hydra-dialog
              className={cn("sidebar-modal", className)}
              initial={{ opacity: 0, y: 24, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16, scale: 0.98 }}
              transition={{
                duration: 0.22,
                ease: [0.22, 1, 0.36, 1],
              }}
            >
              <NavigationLayer
                rootRegionId={modalContentRef.current?.id}
                initialFocusId={activeTabFocusId}
              >
                <aside className="sidebar-modal__sidebar">
                  <div className="sidebar-modal__title">{title}</div>
                  <div className="sidebar-modal__divider" />

                  <VerticalFocusGroup
                    regionId={tabsRegionId}
                    className="sidebar-modal__tabs"
                    style={{ gap: 0 }}
                    navigationOverrides={{
                      right: activeTab
                        ? {
                            type: "region",
                            regionId: contentRegionId,
                            entryDirection: "right",
                            initialFocusId: contentEntryFocusId,
                            preferRememberedFocus: contentEntryFocusId
                              ? false
                              : true,
                          }
                        : { type: "block" },
                    }}
                  >
                    {activeTabMetrics && (
                      <motion.div
                        className="sidebar-modal__tab-active-indicator"
                        data-highlighted={
                          highlightedTabId === activeTab?.id || undefined
                        }
                        style={{ height: activeTabMetrics.height }}
                        animate={{ y: activeTabMetrics.top }}
                        initial={false}
                        transition={{
                          duration: 0.22,
                          ease: [0.22, 1, 0.36, 1],
                        }}
                      />
                    )}

                    {tabs.map((tab) => {
                      const isActive = tab.id === activeTab?.id;

                      return (
                        <FocusItem
                          key={tab.id}
                          id={getTabFocusId(tab.id)}
                          navigationState={tab.disabled ? "disabled" : "active"}
                          actions={{ primary: () => setActiveTab(tab.id) }}
                          asChild
                        >
                          <button
                            type="button"
                            ref={(element) => {
                              tabElementsRef.current[tab.id] = element;
                            }}
                            className="sidebar-modal__tab"
                            data-active={isActive || undefined}
                            disabled={tab.disabled}
                            onClick={() => setActiveTab(tab.id)}
                            onFocus={() => {
                              if (!tab.disabled) {
                                setActiveTab(tab.id);
                                setHighlightedTabId(tab.id);
                              }
                            }}
                            onBlur={() => clearHighlightedTab(tab.id)}
                            onMouseEnter={() => {
                              if (tab.id === activeTab?.id) {
                                setHighlightedTabId(tab.id);
                              }
                            }}
                            onMouseLeave={() => clearHighlightedTab(tab.id)}
                          >
                            <span className="sidebar-modal__tab-label">
                              {tab.label}
                            </span>
                          </button>
                        </FocusItem>
                      );
                    })}
                  </VerticalFocusGroup>
                </aside>

                <VerticalFocusGroup
                  regionId={contentRegionId}
                  className="sidebar-modal__content"
                  navigationOverrides={{
                    left: activeTabFocusId
                      ? { type: "item", itemId: activeTabFocusId }
                      : { type: "block" },
                  }}
                >
                  {activeTab?.content}
                </VerticalFocusGroup>
              </NavigationLayer>
            </motion.aside>
          </Backdrop>
        )}
      </AnimatePresence>
    </FocusRegionContext.Provider>,
    portalTarget
  );
}
