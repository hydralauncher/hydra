import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { XIcon } from "@primer/octicons-react";

import * as styles from "./modal.css";
import { useAppDispatch } from "@renderer/hooks";
import { toggleDragging } from "@renderer/features";

export interface ModalProps {
  visible: boolean;
  title: string;
  description: string;
  onClose: () => void;
  children: React.ReactNode;
}

export function Modal({
  visible,
  title,
  description,
  onClose,
  children,
}: ModalProps) {
  const [isClosing, setIsClosing] = useState(false);
  const dispatch = useAppDispatch();
  const componentId = useId();

  const handleCloseClick = () => {
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
  };

  const isTopMostModal = () => {
    const openModals = document.querySelectorAll("[role=modal-container]");
    return (
      openModals.length &&
      openModals[openModals.length - 1].id === "modal-container-" + componentId
    );
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isTopMostModal()) {
        handleCloseClick();
      }
    };

    window.addEventListener("keydown", onKeyDown, false);
    return () => window.removeEventListener("keydown", onKeyDown, false);
  }, []);

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (!isTopMostModal()) return;

      const modalContent = document.getElementById(
        "modal-content-" + componentId
      );

      const clickedOutsideContent = !modalContent.contains(e.target as Node);

      if (clickedOutsideContent) {
        handleCloseClick();
      }
    };

    window.addEventListener("mousedown", onMouseDown);
    return () => window.removeEventListener("mousedown", onMouseDown);
  }, []);

  useEffect(() => {
    dispatch(toggleDragging(visible));
  }, [dispatch, visible]);

  if (!visible) return null;

  return createPortal(
    <div
      className={styles.backdrop({ closing: isClosing })}
      role="modal-container"
      id={"modal-container-" + componentId}
    >
      <div
        className={styles.modal({ closing: isClosing })}
        id={"modal-content-" + componentId}
      >
        <div className={styles.modalHeader}>
          <div style={{ display: "flex", gap: 4, flexDirection: "column" }}>
            <h3>{title}</h3>
            <p style={{ fontSize: 14 }}>{description}</p>
          </div>

          <button
            type="button"
            onClick={handleCloseClick}
            className={styles.closeModalButton}
          >
            <XIcon className={styles.closeModalButtonIcon} size={24} />
          </button>
        </div>
        <div className={styles.modalContent}>{children}</div>
      </div>
    </div>,
    document.body
  );
}
