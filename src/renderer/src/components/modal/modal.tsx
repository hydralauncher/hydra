import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { XIcon } from "@primer/octicons-react";

import * as styles from "./modal.css";

import { Backdrop } from "../backdrop/backdrop";
import { useTranslation } from "react-i18next";

export interface ModalProps {
  visible: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  large?: boolean;
  children: React.ReactNode;
  clickOutsideToClose?: boolean;
}

export function Modal({
  visible,
  title,
  description,
  onClose,
  large,
  children,
  clickOutsideToClose = true,
}: ModalProps) {
  const [isClosing, setIsClosing] = useState(false);
  const modalContentRef = useRef<HTMLDivElement | null>(null);

  const { t } = useTranslation("modal");

  const handleCloseClick = useCallback(() => {
    setIsClosing(true);
    const zero = performance.now();

    requestAnimationFrame(function animateClosing(time) {
      if (time - zero <= 400) {
        requestAnimationFrame(animateClosing);
      } else {
        onClose();
        setIsClosing(false);
      }
    });
  }, [onClose]);

  const isTopMostModal = () => {
    const openModals = document.querySelectorAll("[role=dialog]");

    return (
      openModals.length &&
      openModals[openModals.length - 1] === modalContentRef.current
    );
  };

  useEffect(() => {
    if (visible) {
      const onKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Escape" && isTopMostModal()) {
          handleCloseClick();
        }
      };

      window.addEventListener("keydown", onKeyDown);

      return () => {
        window.removeEventListener("keydown", onKeyDown);
      };
    }

    return () => {};
  }, [handleCloseClick, visible]);

  useEffect(() => {
    if (clickOutsideToClose) {
      const onMouseDown = (e: MouseEvent) => {
        if (!isTopMostModal()) return;
        if (modalContentRef.current) {
          const clickedWithinModal = modalContentRef.current.contains(
            e.target as Node
          );

          if (!clickedWithinModal) {
            handleCloseClick();
          }
        }
      };

      window.addEventListener("mousedown", onMouseDown);

      return () => {
        window.removeEventListener("mousedown", onMouseDown);
      };
    }

    return () => {};
  }, [clickOutsideToClose, handleCloseClick]);

  if (!visible) return null;

  return createPortal(
    <Backdrop isClosing={isClosing}>
      <div
        className={styles.modal({ closing: isClosing, large })}
        role="dialog"
        aria-labelledby={title}
        aria-describedby={description}
        ref={modalContentRef}
        data-hydra-dialog
      >
        <div className={styles.modalHeader}>
          <div style={{ display: "flex", gap: 4, flexDirection: "column" }}>
            <h3>{title}</h3>
            {description && <p>{description}</p>}
          </div>

          <button
            type="button"
            onClick={handleCloseClick}
            className={styles.closeModalButton}
            aria-label={t("close")}
          >
            <XIcon className={styles.closeModalButtonIcon} size={24} />
          </button>
        </div>
        <div className={styles.modalContent}>{children}</div>
      </div>
    </Backdrop>,
    document.body
  );
}
