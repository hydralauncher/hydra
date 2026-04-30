import "./styles.scss";

import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import cn from "classnames";

import { Backdrop } from "../backdrop";
import { IS_BROWSER } from "../../../constants";

export interface ModalProps {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  closeOnBackdrop?: boolean;
  closeOnEscape?: boolean;
  ariaLabel?: string;
}

export function Modal({
  visible,
  onClose,
  children,
  className,
  closeOnBackdrop = true,
  closeOnEscape = true,
  ariaLabel,
}: Readonly<ModalProps>) {
  const modalContentRef = useRef<HTMLDivElement | null>(null);

  const isTopMostModal = () => {
    if (
      document.querySelector(
        ".featurebase-widget-overlay.featurebase-display-block"
      )
    )
      return false;

    const openModals = document.querySelectorAll("[role=dialog]");
    return (
      openModals.length &&
      openModals[openModals.length - 1] === modalContentRef.current
    );
  };

  const handleCloseClick = useCallback(() => {
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!visible || !closeOnEscape) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isTopMostModal()) {
        handleCloseClick();
      }
    };

    globalThis.window.addEventListener("keydown", onKeyDown);
    return () => globalThis.window.removeEventListener("keydown", onKeyDown);
  }, [closeOnEscape, visible, handleCloseClick]);

  useEffect(() => {
    if (!closeOnBackdrop || !visible) return;

    const onPointerDown = (e: PointerEvent) => {
      if (!isTopMostModal()) return;
      if (
        modalContentRef.current &&
        !modalContentRef.current.contains(e.target as Node)
      ) {
        handleCloseClick();
      }
    };

    globalThis.window.addEventListener("pointerdown", onPointerDown, true);
    return () =>
      globalThis.window.removeEventListener("pointerdown", onPointerDown, true);
  }, [closeOnBackdrop, visible, handleCloseClick]);

  if (!IS_BROWSER) return null;

  const portalTarget = document.getElementById("root") ?? document.body;

  return createPortal(
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
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            {children}
          </motion.aside>
        </Backdrop>
      )}
    </AnimatePresence>,
    portalTarget
  );
}
