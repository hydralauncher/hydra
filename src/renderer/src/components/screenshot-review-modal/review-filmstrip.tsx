import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import cn from "classnames";
import { ChevronLeftIcon, ChevronRightIcon } from "@primer/octicons-react";
import type { LocalScreenshot } from "@types";

import { getLocalImageSource, getReviewTone } from "./screenshot-review-state";

const SCROLL_EDGE_TOLERANCE_PX = 1;

interface ReviewFilmstripProps {
  screenshots: LocalScreenshot[];
  selectedClientId: string | null;
  label: string;
  onSelect: (clientId: string) => void;
}

export function ReviewFilmstrip({
  screenshots,
  selectedClientId,
  label,
  onSelect,
}: Readonly<ReviewFilmstripProps>) {
  const { t } = useTranslation("screenshots_capture");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [fades, setFades] = useState({ start: false, end: false });

  const selectedIndex = screenshots.findIndex(
    (screenshot) => screenshot.clientId === selectedClientId
  );

  const updateFades = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    const maxScroll = element.scrollWidth - element.clientWidth;
    setFades({
      start: element.scrollLeft > SCROLL_EDGE_TOLERANCE_PX,
      end: element.scrollLeft < maxScroll - SCROLL_EDGE_TOLERANCE_PX,
    });
  }, []);

  useEffect(() => {
    updateFades();
    const element = scrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver(updateFades);
    observer.observe(element);
    return () => observer.disconnect();
  }, [screenshots.length, updateFades]);

  useEffect(() => {
    const thumb = scrollRef.current?.children[selectedIndex];
    if (thumb instanceof HTMLElement) {
      thumb.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "nearest",
      });
    }
  }, [selectedIndex]);

  const step = (direction: -1 | 1) => {
    const next = screenshots[selectedIndex + direction];
    if (next) onSelect(next.clientId);
  };

  return (
    <div className="screenshot-review-filmstrip">
      <button
        type="button"
        className="screenshot-review-filmstrip__step"
        disabled={selectedIndex <= 0}
        aria-label={t("previous_screenshot")}
        onClick={() => step(-1)}
      >
        <ChevronLeftIcon size={16} />
      </button>

      <div
        ref={scrollRef}
        className={cn("screenshot-review-filmstrip__thumbs", {
          "screenshot-review-filmstrip__thumbs--fade-start": fades.start,
          "screenshot-review-filmstrip__thumbs--fade-end": fades.end,
        })}
        role="tablist"
        aria-label={label}
        onScroll={updateFades}
      >
        {screenshots.map((screenshot, index) => {
          const isSelected = index === selectedIndex;
          return (
            <button
              key={screenshot.clientId}
              type="button"
              role="tab"
              aria-selected={isSelected}
              aria-label={t("thumbnail_label", {
                index: index + 1,
                count: screenshots.length,
              })}
              className={cn("screenshot-review-filmstrip__thumb", {
                "screenshot-review-filmstrip__thumb--selected": isSelected,
              })}
              onClick={() => onSelect(screenshot.clientId)}
            >
              <img
                src={getLocalImageSource(
                  screenshot.previewPath ?? screenshot.path
                )}
                alt=""
                loading="lazy"
                draggable={false}
              />
              <span
                className={cn(
                  "screenshot-review-filmstrip__status",
                  `screenshot-review-filmstrip__status--${getReviewTone(screenshot)}`
                )}
              />
            </button>
          );
        })}
      </div>

      <button
        type="button"
        className="screenshot-review-filmstrip__step"
        disabled={
          selectedIndex === -1 || selectedIndex >= screenshots.length - 1
        }
        aria-label={t("next_screenshot")}
        onClick={() => step(1)}
      >
        <ChevronRightIcon size={16} />
      </button>
    </div>
  );
}
