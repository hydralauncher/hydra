import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { XIcon } from "@primer/octicons-react";
import { useTranslation } from "react-i18next";

import "./fullscreen-media-modal.scss";

interface MediaSize {
  width: number;
  height: number;
}

const VIEWPORT_FILL_RATIO = 0.88;

const getUpscaledSize = (
  naturalSize: MediaSize | null,
  viewportSize: MediaSize
): MediaSize | null => {
  if (!naturalSize?.width || !naturalSize.height) return null;

  const scale = Math.min(
    (viewportSize.width * VIEWPORT_FILL_RATIO) / naturalSize.width,
    (viewportSize.height * VIEWPORT_FILL_RATIO) / naturalSize.height
  );

  return {
    width: naturalSize.width * scale,
    height: naturalSize.height * scale,
  };
};

export interface FullscreenMediaModalProps {
  visible: boolean;
  onClose: () => void;
  src: string | null | undefined;
  alt?: string;
  upscale?: boolean;
}

export function FullscreenMediaModal({
  visible,
  onClose,
  src,
  alt,
  upscale = false,
}: FullscreenMediaModalProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [naturalSize, setNaturalSize] = useState<MediaSize | null>(null);
  const [viewportSize, setViewportSize] = useState<MediaSize>(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));

  useEffect(() => {
    setNaturalSize(null);
  }, [src]);

  useEffect(() => {
    if (!upscale) return;

    const onResize = () =>
      setViewportSize({
        width: window.innerWidth,
        height: window.innerHeight,
      });

    window.addEventListener("resize", onResize);

    return () => window.removeEventListener("resize", onResize);
  }, [upscale]);

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

  const upscaledSize = upscale
    ? getUpscaledSize(naturalSize, viewportSize)
    : null;

  return createPortal(
    <div className="fullscreen-media-modal__overlay">
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
          <img
            src={src}
            alt={alt}
            className={`fullscreen-media-modal__image${upscale ? " fullscreen-media-modal__image--upscale" : ""}`}
            style={upscaledSize ?? undefined}
            onLoad={(event) =>
              setNaturalSize({
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight,
              })
            }
          />
        </div>
      </dialog>
    </div>,
    document.body
  );
}
