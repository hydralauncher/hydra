import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, type Transition } from "framer-motion";
import cn from "classnames";
import { Backdrop } from "../backdrop";
import { IS_BROWSER } from "../../../constants";
import { FocusRegionContext } from "../../context";
import { useNavigationScreenActions } from "../../../hooks";
import { useInputModeStore, useVirtualKeyboardStore } from "../../../stores";
import { NavigationService } from "../../../services";
import { trapModalTabFocus } from "./tab-focus";
import { focusWithPhysicalKeyboard } from "../../../helpers/physical-keyboard-focus";

import "./styles.scss";
import { ArrowLeftIcon, XIcon } from "@phosphor-icons/react";
import { NavigationLayer } from "../navigation-layer";
import type { ScreenActions } from "../../../types";

export interface ModalProps {
  visible: boolean;
  onClose: () => void;
  onBack?: () => void;
  title: string;
  headerContent?: ReactNode;
  description?: string;
  children: ReactNode;
  className?: string;
  backdropClassName?: string;
  coverImage?: string;
  closeOnBackdrop?: boolean;
  closeOnEscape?: boolean;
  closeOnB?: boolean;
  busy?: boolean;
  ariaLabel?: string;
  animateLayout?: boolean;
  initialFocusId?: string;
  layoutTransition?: Transition;
  onExitComplete?: () => void;
}

export const MODAL_OWNED_OVERLAY_ATTRIBUTE = "data-hydra-modal-owned-overlay";

interface ModalBackActionProps {
  enabled: boolean;
  isExiting: boolean;
  isBusy: boolean;
  onBack: () => void;
}

const swallowBPress = () => {};

function getModalBackActions({
  enabled,
  isExiting,
  isBusy,
  onBack,
}: Readonly<ModalBackActionProps>): ScreenActions {
  if (isExiting || isBusy) return { press: { b: swallowBPress } };
  if (enabled) return { press: { b: onBack } };
  return {};
}

function ModalBackAction(props: Readonly<ModalBackActionProps>) {
  useNavigationScreenActions(getModalBackActions(props));

  return null;
}

export function Modal({
  visible,
  onClose,
  onBack,
  title,
  headerContent,
  description,
  children,
  coverImage,
  className,
  backdropClassName,
  closeOnBackdrop = true,
  closeOnEscape = true,
  closeOnB = true,
  busy = false,
  ariaLabel = title,
  animateLayout = false,
  initialFocusId,
  layoutTransition,
  onExitComplete,
}: Readonly<ModalProps>) {
  const modalContentRef = useRef<HTMLDivElement | null>(null);
  const virtualKeyboardTarget = useVirtualKeyboardStore(
    (state) => state.target
  );
  const isVirtualKeyboardOpen = virtualKeyboardTarget !== null;
  const [wasVisible, setWasVisible] = useState(visible);
  const [isExiting, setIsExiting] = useState(false);

  if (wasVisible !== visible) {
    setWasVisible(visible);
    setIsExiting(!visible);
  }

  const handleExitComplete = useCallback(() => {
    setIsExiting(false);
    onExitComplete?.();
  }, [onExitComplete]);

  const isTopMostModal = () => {
    const openModals = document.querySelectorAll("[role=dialog], dialog[open]");
    return (
      openModals.length &&
      openModals[openModals.length - 1] === modalContentRef.current
    );
  };

  const handleCloseClick = useCallback(() => {
    onClose();
  }, [onClose]);

  const handleHeaderKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>
  ) => {
    // Header buttons use native keyboard activation rather than the last
    // focused controller action.
    if (event.key === "Enter" || event.key === " ") {
      event.stopPropagation();
    }
  };

  const shouldCloseOnB = visible && closeOnB && !busy && !isVirtualKeyboardOpen;
  const isBusyOnB = visible && busy && !isVirtualKeyboardOpen;

  const resolvedLayoutTransition = layoutTransition ?? {
    duration: 0.4,
    ease: "easeInOut",
  };

  const handleBPress = useCallback(() => {
    if (!isTopMostModal()) return;
    handleCloseClick();
  }, [handleCloseClick]);

  useEffect(() => {
    if (!visible) return;

    const onTabKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || event.ctrlKey || event.altKey || event.metaKey)
        return;
      if (useVirtualKeyboardStore.getState().target !== null) return;
      if (!isTopMostModal() || !modalContentRef.current) return;

      const nextControl = trapModalTabFocus(event, modalContentRef.current);
      const inputMode = useInputModeStore.getState();
      inputMode.setGamepadMode();
      inputMode.clearPendingGamepadFocus();

      const navigationItem = nextControl.closest<HTMLElement>(
        '[data-navigation-state="active"]'
      );
      if (navigationItem) {
        NavigationService.getInstance().setFocus(navigationItem.id);
      }
      focusWithPhysicalKeyboard(nextControl);
    };

    globalThis.window.addEventListener("keydown", onTabKeyDown, true);
    return () =>
      globalThis.window.removeEventListener("keydown", onTabKeyDown, true);
  }, [visible]);

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
      {visible || isExiting ? (
        <ModalBackAction
          enabled={shouldCloseOnB}
          isExiting={isExiting}
          isBusy={isBusyOnB}
          onBack={handleBPress}
        />
      ) : null}
      <AnimatePresence onExitComplete={handleExitComplete}>
        {visible && (
          <Backdrop className={backdropClassName}>
            <motion.aside
              role="dialog"
              aria-modal="true"
              aria-label={ariaLabel}
              ref={modalContentRef}
              data-hydra-dialog
              tabIndex={-1}
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
                        onKeyDown={handleHeaderKeyDown}
                      >
                        <ArrowLeftIcon size={20} />
                      </button>
                    )}

                    {headerContent ?? <h4>{title}</h4>}
                  </div>

                  {description && (
                    <p className="modal__header-description">{description}</p>
                  )}

                  <button
                    className="modal__header-close-button"
                    onClick={handleCloseClick}
                    onKeyDown={handleHeaderKeyDown}
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
