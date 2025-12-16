import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { XIcon } from "@primer/octicons-react";
import { useTranslation } from "react-i18next";

import { Backdrop } from "../backdrop/backdrop";
import "./fullscreen-media-modal.scss";

export interface FullscreenMediaModalProps {
  visible: boolean;
  onClose: () => void;
  src: string | null | undefined;
  alt?: string;
}

export function FullscreenMediaModal({
  visible,
  onClose,
  src,
  alt,
}: FullscreenMediaModalProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const { t } = useTranslation("modal");

  useEffect(() => {
    if (visible) {
      const onKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          onClose();
        }
      };

      window.addEventListener("keydown", onKeyDown);

      return () => {
        window.removeEventListener("keydown", onKeyDown);
      };
    }

    return () => {};
  }, [onClose, visible]);

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (containerRef.current) {
        const clickedOnImage = containerRef.current.contains(e.target as Node);

        if (!clickedOnImage) {
          onClose();
        }
      }
    };

    if (visible) {
      window.addEventListener("mousedown", onMouseDown);
    }

    return () => {
      window.removeEventListener("mousedown", onMouseDown);
    };
  }, [onClose, visible]);

  if (!visible || !src) return null;

  return createPortal(
    <Backdrop>
      <dialog className="fullscreen-media-modal" open aria-label={alt}>
        <button
          type="button"
          onClick={onClose}
          className="fullscreen-media-modal__close-button"
          aria-label={t("close")}
        >
          <XIcon size={24} />
        </button>

        <div
          ref={containerRef}
          className="fullscreen-media-modal__image-container"
        >
          <img src={src} alt={alt} className="fullscreen-media-modal__image" />
        </div>
      </dialog>
    </Backdrop>,
    document.body
  );
}
