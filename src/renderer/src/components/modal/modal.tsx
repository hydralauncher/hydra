import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { XIcon } from "@primer/octicons-react";

import "./modal.scss";

import { Backdrop } from "../backdrop/backdrop";
import { useTranslation } from "react-i18next";
import cn from "classnames";

export interface ModalProps {
  visible: boolean;
  title: React.ReactNode;
  description?: string;
  onClose: () => void;
  large?: boolean;
  noContentPadding?: boolean;
  children: React.ReactNode;
  clickOutsideToClose?: boolean;
}

export function Modal({
  visible,
  title,
  description,
  onClose,
  large,
  noContentPadding,
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
      const onPointerDown = (e: PointerEvent) => {
        if (!isTopMostModal()) return;
        const target = e.target as Element | null;

        const hasOpenDropdownMenu =
          document.querySelector(".dropdown-menu__content") !== null;

        if (hasOpenDropdownMenu && !modalContentRef.current?.contains(target)) {
          return;
        }

        if (modalContentRef.current) {
          const clickedWithinModal = modalContentRef.current.contains(
            e.target as Node
          );

          if (!clickedWithinModal) {
            handleCloseClick();
          }
        }
      };

      window.addEventListener("pointerdown", onPointerDown, true);

      return () => {
        window.removeEventListener("pointerdown", onPointerDown, true);
      };
    }

    return () => {};
  }, [clickOutsideToClose, handleCloseClick]);

  if (!visible) return null;

  return createPortal(
    <Backdrop isClosing={isClosing}>
      <div
        className={cn("modal", {
          "modal--closing": isClosing,
          "modal--large": large,
        })}
        role="dialog"
        aria-describedby={description}
        ref={modalContentRef}
        data-hydra-dialog
      >
        <div className="modal__header">
          <div className="modal__header-title">
            <h3>{title}</h3>
            {description && <p>{description}</p>}
          </div>

          <button
            type="button"
            onClick={handleCloseClick}
            className="modal__close-button"
            aria-label={t("close")}
          >
            <XIcon className="modal__close-button-icon" size={24} />
          </button>
        </div>
        <div
          className={cn("modal__content", {
            "modal__content--no-padding": noContentPadding,
          })}
        >
          {children}
        </div>
      </div>
    </Backdrop>,
    document.body
  );
}
