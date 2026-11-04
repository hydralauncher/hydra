import { useId } from "react";
import cn from "classnames";
import type { RecompilationTestedLevel } from "@types";

import "./tested-medal.scss";

export interface TestedMedalProps {
  level: RecompilationTestedLevel;
  size?: number;
  className?: string;
}

const TIER_COLORS: Record<
  Exclude<RecompilationTestedLevel, "untested">,
  [string, string, string]
> = {
  platinum: ["#d6fff6", "#5ee6c8", "#159c84"],
  gold: ["#fff1c2", "#f2c94c", "#b7861f"],
  silver: ["#ffffff", "#c9ced6", "#848b97"],
  bronze: ["#ffd9bd", "#d98f5c", "#94552c"],
};

export function TestedMedal({
  level,
  size = 12,
  className,
}: Readonly<TestedMedalProps>) {
  const id = useId();

  if (level === "untested") {
    return (
      <svg
        className={cn("tested-medal", "tested-medal--untested", className)}
        width={size}
        height={size}
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <circle className="tested-medal__empty" cx="12" cy="12" r="10.5" />
        <path className="tested-medal__dash" d="M8.5 12h7" />
      </svg>
    );
  }

  const [light, base, dark] = TIER_COLORS[level];

  return (
    <svg
      className={cn("tested-medal", `tested-medal--${level}`, className)}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`${id}-face`} x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0%" stopColor={light} />
          <stop offset="55%" stopColor={base} />
          <stop offset="100%" stopColor={dark} />
        </linearGradient>
        <linearGradient id={`${id}-inner`} x1="0.8" y1="1" x2="0.2" y2="0">
          <stop offset="0%" stopColor={light} />
          <stop offset="60%" stopColor={base} />
          <stop offset="100%" stopColor={dark} />
        </linearGradient>
      </defs>
      <circle cx="12" cy="12" r="11" fill={`url(#${id}-face)`} />
      <circle
        cx="12"
        cy="12"
        r="8"
        fill={`url(#${id}-inner)`}
        className="tested-medal__inner"
      />
      <path className="tested-medal__mark" d="M8.4 12.2l2.5 2.5 4.7-4.9" />
    </svg>
  );
}
