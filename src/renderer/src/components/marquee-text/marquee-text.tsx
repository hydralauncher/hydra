import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import cn from "classnames";

import "./marquee-text.scss";

export interface MarqueeTextProps {
  text: string;
  className?: string;
  /** Scroll speed in pixels per second. */
  speed?: number;
  /** Space between the end of the text and its repeated copy, in pixels. */
  gap?: number;
  /** Scroll all the time instead of only while hovered or focused. */
  autoplay?: boolean;
}

/**
 * Single-line text that scrolls horizontally when it does not fit its
 * container. Text that fits is rendered as-is. The scroll runs while the
 * element (or a `.marquee-text-trigger` ancestor) is hovered or focused,
 * unless `autoplay` is set.
 */
export function MarqueeText({
  text,
  className,
  speed = 40,
  gap = 32,
  autoplay = false,
}: Readonly<MarqueeTextProps>) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const contentRef = useRef<HTMLSpanElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const [distance, setDistance] = useState(0);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) return;

    const measure = () => {
      const contentWidth = content.getBoundingClientRect().width;
      const containerWidth = container.clientWidth;

      setIsOverflowing(contentWidth - containerWidth > 1);
      setDistance(contentWidth + gap);
    };

    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(container);
    observer.observe(content);

    return () => observer.disconnect();
  }, [text, gap]);

  const duration = Math.max(distance / speed, 2);

  return (
    <span
      ref={containerRef}
      className={cn("marquee-text", className, {
        "marquee-text--overflowing": isOverflowing,
        "marquee-text--autoplay": autoplay,
      })}
      title={isOverflowing ? text : undefined}
      style={
        {
          "--marquee-distance": `${distance}px`,
          "--marquee-duration": `${duration}s`,
          "--marquee-gap": `${gap}px`,
        } as CSSProperties
      }
    >
      <span className="marquee-text__track">
        <span ref={contentRef} className="marquee-text__content">
          {text}
        </span>
        {isOverflowing ? (
          <span className="marquee-text__content" aria-hidden="true">
            {text}
          </span>
        ) : null}
      </span>
    </span>
  );
}
