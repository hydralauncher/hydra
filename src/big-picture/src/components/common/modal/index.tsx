import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, type Transition } from "framer-motion";
import cn from "classnames";
import { Backdrop } from "../backdrop";
import { IS_BROWSER } from "../../../constants";
import { FocusRegionContext } from "../../context";
import { useNavigationScreenActions } from "../../../hooks";
import { useVirtualKeyboardStore } from "../../../stores";

import "./styles.scss";
import { ArrowLeftIcon, XIcon } from "@phosphor-icons/react";
import { NavigationLayer } from "../navigation-layer";

export interface ModalProps {
  visible: boolean;
  onClose: () => void;
  onBack?: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
  coverImage?: string;
  closeOnBackdrop?: boolean;
  closeOnEscape?: boolean;
  closeOnB?: boolean;
  ariaLabel?: string;
  animateLayout?: boolean;
  initialFocusId?: string;
  layoutTransition?: Transition;
}

export const MODAL_OWNED_OVERLAY_ATTRIBUTE = "data-hydra-modal-owned-overlay";

export function Modal({
  visible,
  onClose,
  onBack,
  title,
  description,
  children,
  coverImage,
  className,
  closeOnBackdrop = true,
  closeOnEscape = true,
  closeOnB = true,
  ariaLabel = title,
  animateLayout = false,
  initialFocusId,
  layoutTransition,
}: Readonly<ModalProps>) {
  const modalContentRef = useRef<HTMLDivElement | null>(null);
  const virtualKeyboardTarget = useVirtualKeyboardStore(
    (state) => state.target
  );
  const isVirtualKeyboardOpen = virtualKeyboardTarget !== null;

  const isTopMostModal = () => {
    const openModals = document.querySelectorAll("[role=dialog]");
    return (
      openModals.length &&
      openModals[openModals.length - 1] === modalContentRef.current
    );
  };

  const handleCloseClick = useCallback(() => {
    onClose();
  }, [onClose]);

  const shouldCloseOnB = visible && closeOnB && !isVirtualKeyboardOpen;
  const resolvedLayoutTransition = layoutTransition ?? {
    duration: 0.4,
    ease: "easeInOut",
  };

  const handleBPress = useCallback(() => {
    if (!isTopMostModal()) return;
    handleCloseClick();
  }, [handleCloseClick]);

  useNavigationScreenActions(
    shouldCloseOnB ? { press: { b: handleBPress } } : {}
  );

  useEffect(() => {
    if (!visible || !closeOnEscape) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (event.defaultPrevented) return;
      if (useVirtualKeyboardStore.getState().target !== null) return;
      if (!isTopMostModal()) return;

      handleCloseClick();
    };

    globalThis.window.addEventListener("keydown", onKeyDown);
    return () => globalThis.window.removeEventListener("keydown", onKeyDown);
  }, [closeOnEscape, visible, handleCloseClick]);

  useEffect(() => {
    if (!closeOnBackdrop || !visible) return;

    const onPointerDown = (e: PointerEvent) => {
      if (!isTopMostModal()) return;

      const target = e.target as Node | null;
      const targetElement = target instanceof Element ? target : null;
      const clickedOwnedOverlay = targetElement?.closest(
        `[${MODAL_OWNED_OVERLAY_ATTRIBUTE}]`
      );

      const clickedOutside =
        modalContentRef.current &&
        target &&
        !modalContentRef.current.contains(target) &&
        !clickedOwnedOverlay;

      if (clickedOutside) handleCloseClick();
    };

    globalThis.window.addEventListener("pointerdown", onPointerDown, true);
    return () =>
      globalThis.window.removeEventListener("pointerdown", onPointerDown, true);
  }, [closeOnBackdrop, visible, handleCloseClick]);

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
              role="dialog"
              aria-modal="true"
              aria-label={ariaLabel}
              ref={modalContentRef}
              data-hydra-dialog
              className={cn("modal", className)}
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
                initialFocusId={initialFocusId}
              >
                <div className="modal__header">
                  {coverImage && (
                    <div className="modal__header-cover-image">
                      <img src={coverImage} alt={title} />
                    </div>
                  )}

                  <div className="modal__header-title">
                    {onBack && (
                      <button
                        className="modal__header-back-button"
                        onClick={onBack}
                      >
                        <ArrowLeftIcon size={20} />
                      </button>
                    )}

                    <h4>{title}</h4>
                  </div>

                  {description && (
                    <p className="modal__header-description">{description}</p>
                  )}

                  <button
                    className="modal__header-close-button"
                    onClick={handleCloseClick}
                  >
                    <XIcon size={24} />
                  </button>
                </div>

                <motion.div
                  className="modal__body"
                  layout={animateLayout || undefined}
                  transition={{
                    layout: resolvedLayoutTransition,
                  }}
                >
                  <div className="modal__divider" />

                  <div className="modal__content">{children}</div>
                </motion.div>
              </NavigationLayer>
            </motion.aside>
          </Backdrop>
        )}
      </AnimatePresence>
    </FocusRegionContext.Provider>,
    portalTarget
  );
}
