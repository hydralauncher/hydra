import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Skeleton from "react-loading-skeleton";
import { GameCard } from "@renderer/components";
import type { ShopAssets } from "@types";
import "./category-row.scss";

const SKELETON_COUNT = 8;

interface CategoryRowProps {
  title: string;
  games: ShopAssets[];
  isLoading: boolean;
  onGameClick: (game: ShopAssets) => void;
}

export function CategoryRow({
  title,
  games,
  isLoading,
  onGameClick,
}: CategoryRowProps) {
  const { t } = useTranslation("home");
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartX = useRef(0);
  const scrollStartX = useRef(0);

  const updateScrollButtons = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    setCanScrollLeft(scrollLeft > 4);
    setCanScrollRight(scrollLeft < scrollWidth - clientWidth - 4);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    el.addEventListener("scroll", updateScrollButtons);
    updateScrollButtons();

    return () => {
      el.removeEventListener("scroll", updateScrollButtons);
    };
  }, [updateScrollButtons, games]);

  const scrollBy = useCallback((direction: "left" | "right") => {
    const el = scrollRef.current;
    if (!el) return;
    const amount = el.clientWidth * 0.75;
    el.scrollBy({
      left: direction === "left" ? -amount : amount,
      behavior: "smooth",
    });
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    setIsDragging(true);
    dragStartX.current = e.clientX;
    if (scrollRef.current) {
      scrollStartX.current = scrollRef.current.scrollLeft;
    }
  }, []);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDragging || !scrollRef.current) return;
      const diff = e.clientX - dragStartX.current;
      scrollRef.current.scrollLeft = scrollStartX.current - diff;
    },
    [isDragging]
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Intercept all wheel events at the window capture phase before any
  // passive listeners fire. This reliably prevents vertical page scroll
  // while the mouse is over the horizontal track.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      if (el.contains(e.target as Node) && Math.abs(e.deltaY) > 0) {
        e.preventDefault();
        el.scrollBy({ left: e.deltaY, behavior: "auto" });
      }
    };

    window.addEventListener("wheel", onWheel, {
      passive: false,
      capture: true,
    });
    return () =>
      window.removeEventListener("wheel", onWheel, { capture: true });
  }, []);

  return (
    <section className="category-row">
      <h2 className="category-row__title">{title}</h2>

      <div className="category-row__wrapper">
        {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
        <div
          className="category-row__track"
          ref={scrollRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          style={{ cursor: isDragging ? "grabbing" : "grab" }}
        >
          {isLoading
            ? Array.from({ length: SKELETON_COUNT }).map((_, index) => (
                <Skeleton key={index} className="category-row__skeleton" />
              ))
            : games.map((game) => (
                <div key={game.objectId} className="category-row__card">
                  <GameCard game={game} onClick={() => onGameClick(game)} />
                </div>
              ))}
        </div>

        <button
          type="button"
          className={`category-row__arrow category-row__arrow--left${canScrollLeft ? " category-row__arrow--visible" : ""}`}
          onClick={() => scrollBy("left")}
          aria-label={t("scroll_left")}
          tabIndex={canScrollLeft ? 0 : -1}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M13 16L7 10L13 4"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        <button
          type="button"
          className={`category-row__arrow category-row__arrow--right${canScrollRight ? " category-row__arrow--visible" : ""}`}
          onClick={() => scrollBy("right")}
          aria-label={t("scroll_right")}
          tabIndex={canScrollRight ? 0 : -1}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M7 4L13 10L7 16"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
    </section>
  );
}
