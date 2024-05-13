import { useState } from "react";
import * as styles from "./tooltip.css";

interface TooltipProps {
  children: React.ReactNode;
  tooltipText: string;
}

export function Tooltip({ children, tooltipText }: Readonly<TooltipProps>) {
  const [isVisible, setIsVisible] = useState(false);

  return (
    <div
      className={styles.tooltipStyle}
      onMouseEnter={() => setIsVisible(true)}
      onMouseLeave={() => setIsVisible(false)}
    >
      {children}
      <span
        className={`${styles.tooltipTextStyle} ${isVisible ? styles.tooltipVisible : ""}`}
      >
        {tooltipText}
      </span>
    </div>
  );
}
