import { useEffect } from "react";
import { XIcon } from "@primer/octicons-react";
import "./fullscreen-image-modal.scss";

interface FullscreenImageModalProps {
  isOpen: boolean;
  imageUrl: string;
  imageAlt: string;
  onClose: () => void;
}

export function FullscreenImageModal({
  isOpen,
  imageUrl,
  imageAlt,
  onClose,
}: FullscreenImageModalProps) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "hidden";
    }

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "unset";
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fullscreen-image-modal"
      role="dialog"
      aria-modal="true"
      tabIndex={-1}
    >
      <button
        type="button"
        className="fullscreen-image-modal__backdrop"
        onClick={onClose}
        aria-label="Close fullscreen image"
      />
      <div className="fullscreen-image-modal__container">
        <button
          className="fullscreen-image-modal__close-button"
          onClick={onClose}
          aria-label="Close fullscreen image"
        >
          <XIcon size={24} />
        </button>

        <div className="fullscreen-image-modal__image-container">
          <img
            src={imageUrl}
            alt={imageAlt}
            className="fullscreen-image-modal__image"
            loading="eager"
          />
        </div>
      </div>
    </div>
  );
}
