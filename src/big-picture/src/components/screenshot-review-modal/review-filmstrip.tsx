import { CheckIcon, CloudArrowUpIcon, ImageIcon } from "@phosphor-icons/react";
import cn from "classnames";
import { motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { LocalScreenshot } from "@types";

import { BumperBadge } from "../common";
import { useFocusLayerId } from "../context";
import { resolveImageSource } from "../../helpers";
import { useGamepad } from "../../hooks";
import { NavigationService } from "../../services";
import { GamepadButtonType, type GamepadButtonPressEvent } from "../../types";
import type { ReviewDecision, ReviewQueueItem } from "./review-queue";

const RING_TRANSITION = {
  type: "spring",
  stiffness: 420,
  damping: 34,
  mass: 0.8,
} as const;

interface ReviewFilmstripThumbnailProps {
  screenshot: LocalScreenshot | undefined;
  decision: ReviewDecision | undefined;
  isSelected: boolean;
  label: string;
  onSelect: () => void;
}

function ReviewFilmstripThumbnail({
  screenshot,
  decision,
  isSelected,
  label,
  onSelect,
}: Readonly<ReviewFilmstripThumbnailProps>) {
  const [hasFailed, setHasFailed] = useState(false);
  const source = screenshot
    ? resolveImageSource(screenshot.previewPath ?? screenshot.path)
    : "";
  const isUploaded = screenshot?.state === "uploaded";

  return (
    <button
      type="button"
      tabIndex={-1}
      className={cn("screenshot-review-modal__thumb", {
        "screenshot-review-modal__thumb--selected": isSelected,
        "screenshot-review-modal__thumb--decided": Boolean(decision),
      })}
      aria-label={label}
      aria-current={isSelected ? "true" : undefined}
      title={label}
      onClick={onSelect}
    >
      <span className="screenshot-review-modal__thumb-media">
        {source && !hasFailed ? (
          <img
            src={source}
            alt=""
            draggable={false}
            loading="lazy"
            onError={() => setHasFailed(true)}
          />
        ) : (
          <ImageIcon size={18} />
        )}
      </span>
      {isSelected ? (
        <motion.span
          layoutId="screenshot-review-thumb-ring"
          className="screenshot-review-modal__thumb-ring"
          transition={RING_TRANSITION}
          aria-hidden
        />
      ) : null}
      {decision ? (
        <span className="screenshot-review-modal__thumb-status" aria-hidden>
          {decision === "upload" && isUploaded ? (
            <CheckIcon size={12} weight="bold" />
          ) : null}
          {decision === "upload" && !isUploaded ? (
            <CloudArrowUpIcon size={12} />
          ) : null}
        </span>
      ) : null}
    </button>
  );
}

const SCROLL_EDGE_TOLERANCE_PX = 1;
const SCROLL_FADE_CLEARANCE_PX = 56;
const SCROLL_DURATION_MS = 280;

const easeOutCubic = (progress: number) => 1 - (1 - progress) ** 3;

const getThumbScrollTarget = (
  container: HTMLElement,
  thumb: HTMLElement,
  position: number,
  count: number
) => {
  const maxScroll = container.scrollWidth - container.clientWidth;
  if (position === 0) return 0;
  if (position === count - 1) return maxScroll;

  const containerRect = container.getBoundingClientRect();
  const thumbRect = thumb.getBoundingClientRect();
  const thumbStart = thumbRect.left - containerRect.left + container.scrollLeft;
  const thumbEnd = thumbStart + thumbRect.width;
  const visibleStart = container.scrollLeft + SCROLL_FADE_CLEARANCE_PX;
  const visibleEnd =
    container.scrollLeft + container.clientWidth - SCROLL_FADE_CLEARANCE_PX;

  if (thumbStart < visibleStart) {
    return Math.max(0, thumbStart - SCROLL_FADE_CLEARANCE_PX);
  }
  if (thumbEnd > visibleEnd) {
    return Math.min(
      maxScroll,
      thumbEnd - container.clientWidth + SCROLL_FADE_CLEARANCE_PX
    );
  }
  return container.scrollLeft;
};

function useScrollEdges(itemCount: number) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [edges, setEdges] = useState({ start: false, end: false });

  const update = useCallback(() => {
    const element = ref.current;
    if (!element) return;
    const maxScroll = element.scrollWidth - element.clientWidth;
    const start = element.scrollLeft > SCROLL_EDGE_TOLERANCE_PX;
    const end = element.scrollLeft < maxScroll - SCROLL_EDGE_TOLERANCE_PX;
    setEdges((current) =>
      current.start === start && current.end === end ? current : { start, end }
    );
  }, []);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [itemCount, update]);

  return { ref, edges, update };
}

interface ReviewFilmstripProps {
  items: ReviewQueueItem[];
  screenshots: LocalScreenshot[];
  decisions: Record<string, ReviewDecision>;
  currentClientId: string;
  isLocked: boolean;
  onSelect: (clientId: string) => void;
  onStep: (direction: -1 | 1) => void;
}

export function ReviewFilmstrip({
  items,
  screenshots,
  decisions,
  currentClientId,
  isLocked,
  onSelect,
  onStep,
}: Readonly<ReviewFilmstripProps>) {
  const { t } = useTranslation("big_picture");
  const layerId = useFocusLayerId();
  const { onButtonPressed, isActiveGamepadEvent } = useGamepad();
  const scroll = useScrollEdges(items.length);
  const scrollRef = scroll.ref;
  const currentPosition = items.findIndex(
    (item) => item.clientId === currentClientId
  );

  useEffect(() => {
    const element = scrollRef.current;
    const thumb = element?.children[currentPosition];
    if (!element || !(thumb instanceof HTMLElement)) return;

    const from = element.scrollLeft;
    const to = getThumbScrollTarget(
      element,
      thumb,
      currentPosition,
      items.length
    );
    if (Math.abs(to - from) < SCROLL_EDGE_TOLERANCE_PX) return;

    let frameId = 0;
    const startedAt = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / SCROLL_DURATION_MS);
      element.scrollLeft = from + (to - from) * easeOutCubic(progress);
      if (progress < 1) frameId = globalThis.requestAnimationFrame(tick);
    };
    frameId = globalThis.requestAnimationFrame(tick);

    return () => globalThis.cancelAnimationFrame(frameId);
  }, [currentPosition, items.length, scrollRef]);

  useEffect(() => {
    if (isLocked) return;

    const navigation = NavigationService.getInstance();
    const step = (direction: -1 | 1) => (event: GamepadButtonPressEvent) => {
      if (!isActiveGamepadEvent(event)) return;
      if (navigation.getActiveLayerId() !== layerId) return;
      onStep(direction);
    };
    const removeLeft = onButtonPressed(GamepadButtonType.LEFT_BUMPER, step(-1));
    const removeRight = onButtonPressed(
      GamepadButtonType.RIGHT_BUMPER,
      step(1)
    );

    return () => {
      removeLeft();
      removeRight();
    };
  }, [isActiveGamepadEvent, isLocked, layerId, onButtonPressed, onStep]);

  if (items.length < 2) return null;

  return (
    <div className="screenshot-review-modal__filmstrip">
      <BumperBadge label="LB" />
      <motion.div
        ref={scroll.ref}
        layoutScroll
        className={cn("screenshot-review-modal__thumbs", {
          "screenshot-review-modal__thumbs--fade-start": scroll.edges.start,
          "screenshot-review-modal__thumbs--fade-end": scroll.edges.end,
        })}
        onScroll={scroll.update}
      >
        {items.map((item, position) => (
          <ReviewFilmstripThumbnail
            key={item.clientId}
            screenshot={screenshots.find(
              (screenshot) => screenshot.clientId === item.clientId
            )}
            decision={decisions[item.clientId]}
            isSelected={item.clientId === currentClientId}
            label={t("screenshots_review_counter", {
              current: position + 1,
              total: items.length,
            })}
            onSelect={() => {
              if (!isLocked) onSelect(item.clientId);
            }}
          />
        ))}
      </motion.div>
      <BumperBadge label="RB" />
    </div>
  );
}
