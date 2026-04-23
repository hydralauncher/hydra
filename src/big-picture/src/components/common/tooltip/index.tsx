import "./styles.scss";

import { useState, type CSSProperties, type ReactNode } from "react";

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

  if (!active) return children;

  const tooltipStyle = {
    "--tooltip-offset": `${offset}px`,
  } as CSSProperties;

  return (
    // eslint-disable-next-line jsx-a11y/mouse-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div
      className="tooltip"
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      onFocus={() => setIsHovering(true)}
      onBlur={() => setIsHovering(false)}
      style={style}
    >
      {children}
      {isHovering && (
        <div
          className={`tooltip__portal tooltip__content--${position} ${className}`}
          data-offset={offset}
          data-show-arrow={showArrow}
          style={tooltipStyle}
          role="tooltip"
          id={id}
        >
          {content}
        </div>
      )}
    </div>
  );
}
