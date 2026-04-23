import "./styles.scss";

import {
  useRef,
  useState,
  useEffect,
  useCallback,
  useMemo,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

export interface TooltipProps {
  children: ReactNode;
  content: string;
  position?: "top" | "bottom" | "left" | "right";
  showArrow?: boolean;
  offset?: number;
  active?: boolean;
  className?: string;
  id?: string;
  style?: CSSProperties;
}

export function Tooltip({
  children,
  content,
  position = "top",
  offset = 8,
  showArrow = true,
  active = true,
  className = "",
  id,
  style,
}: Readonly<TooltipProps>) {
  const [isHovering, setIsHovering] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });
  const triggerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const scrollTimeoutRef = useRef<number | null>(null);

  const calculatePosition = useCallback(() => {
    if (!triggerRef.current) return;

    const rect = triggerRef.current.getBoundingClientRect();
    const scrollX = globalThis.window.scrollX;
    const scrollY = globalThis.window.scrollY;

    let x = 0,
      y = 0;

    switch (position) {
      case "top":
        x = rect.left + scrollX + rect.width / 2;
        y = rect.top + scrollY - offset;
        break;
      case "bottom":
        x = rect.left + scrollX + rect.width / 2;
        y = rect.bottom + scrollY + offset;
        break;
      case "left":
        x = rect.left + scrollX - offset;
        y = rect.top + scrollY + rect.height / 2;
        break;
      case "right":
        x = rect.right + scrollX + offset;
        y = rect.top + scrollY + rect.height / 2;
        break;
    }

    setTooltipPosition({ x, y });
  }, [position, offset]);

  const handleMouseEnter = () => {
    if (scrollTimeoutRef.current) {
      globalThis.window.clearTimeout(scrollTimeoutRef.current);
    }
    setIsHovering(true);
    calculatePosition();
  };

  const handleMouseLeave = () => setIsHovering(false);

  const handleScroll = useCallback(() => {
    setIsHovering(false);

    scrollTimeoutRef.current = globalThis.window.setTimeout(() => {
      if (triggerRef.current?.matches(":hover")) {
        setIsHovering(true);
        calculatePosition();
      }
      scrollTimeoutRef.current = null;
    }, 100);
  }, [calculatePosition]);

  useEffect(() => {
    const currentTimeout = scrollTimeoutRef.current;

    if (isHovering) {
      globalThis.window.addEventListener("scroll", handleScroll, true);
      globalThis.window.addEventListener("resize", handleScroll);
    }

    return () => {
      globalThis.window.removeEventListener("scroll", handleScroll, true);
      globalThis.window.removeEventListener("resize", handleScroll);
      if (currentTimeout) {
        globalThis.window.clearTimeout(currentTimeout);
      }
    };
  }, [isHovering, handleScroll]);

  const tooltipContent = useMemo(
    () => (
      <div
        ref={tooltipRef}
        className={`tooltip__portal tooltip__content--${position} ${className}`}
        data-offset={offset}
        data-show-arrow={showArrow}
        style={{
          left: tooltipPosition.x,
          top: tooltipPosition.y,
        }}
        role="tooltip"
        id={id}
      >
        {content}
      </div>
    ),
    [tooltipPosition, position, offset, showArrow, content, className, id]
  );

  if (!active) return children;

  const portalTarget = document.getElementById("root") ?? document.body;

  return (
    <>
      <div
        ref={triggerRef}
        className="tooltip"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        role="tooltip"
        aria-hidden={!isHovering}
        style={style}
      >
        {children}
      </div>
      {isHovering && createPortal(tooltipContent, portalTarget)}
    </>
  );
}
