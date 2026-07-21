import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
  XIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from "@primer/octicons-react";
import { VideoPlayer } from "./video-player";
import type { GalleryMediaItem } from "./gallery-slider";
import "./gallery-lightbox.scss";

export interface GalleryLightboxProps {
  visible: boolean;
  items: GalleryMediaItem[];
  index: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
}

export function GalleryLightbox({
  visible,
  items,
  index,
  onClose,
  onNavigate,
}: Readonly<GalleryLightboxProps>) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { t } = useTranslation("game_details");

  const hasPrevious = index > 0;
  const hasNext = index < items.length - 1;

  useEffect(() => {
    if (!visible) return () => {};

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowLeft" && hasPrevious) {
        onNavigate(index - 1);
      } else if (e.key === "ArrowRight" && hasNext) {
        onNavigate(index + 1);
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [visible, onClose, onNavigate, index, hasPrevious, hasNext]);

  useEffect(() => {
    if (!visible) return () => {};

    const onMouseDown = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };

    window.addEventListener("mousedown", onMouseDown);

    return () => {
      window.removeEventListener("mousedown", onMouseDown);
    };
  }, [visible, onClose]);

  if (!visible) return null;

  const item = items[index];
  if (!item) return null;

  return createPortal(
    <div className="gallery-lightbox__overlay">
      <dialog className="gallery-lightbox" open aria-label={item.alt}>
        <button
          type="button"
          onClick={onClose}
          className="gallery-lightbox__close-button"
          aria-label={t("close")}
        >
          <XIcon size={24} />
        </button>

        <button
          type="button"
          onClick={() => onNavigate(index - 1)}
          disabled={!hasPrevious}
          className={`gallery-lightbox__nav-button gallery-lightbox__nav-button--left ${
            !hasPrevious ? "gallery-lightbox__nav-button--hidden" : ""
          }`}
          aria-label={t("previous_media")}
        >
          <ChevronLeftIcon size={28} />
        </button>

        <button
          type="button"
          onClick={() => onNavigate(index + 1)}
          disabled={!hasNext}
          className={`gallery-lightbox__nav-button gallery-lightbox__nav-button--right ${
            !hasNext ? "gallery-lightbox__nav-button--hidden" : ""
          }`}
          aria-label={t("next_media")}
        >
          <ChevronRightIcon size={28} />
        </button>

        <div ref={containerRef} className="gallery-lightbox__media-container">
          {item.type === "video" ? (
            <VideoPlayer
              key={item.id}
              videoSrc={item.videoSrc}
              videoType={item.videoType}
              poster={item.poster}
              autoplay
              muted={false}
              controls
              className="gallery-lightbox__media"
            />
          ) : (
            <img
              src={item.src}
              alt={item.alt}
              className="gallery-lightbox__media"
            />
          )}
        </div>
      </dialog>
    </div>,
    document.body
  );
}
