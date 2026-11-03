import cn from "classnames";
import type { RecompilationTestedLevel } from "@types";

import "./tested-medal.scss";

export interface TestedMedalProps {
  level: RecompilationTestedLevel;
  size?: number;
  className?: string;
}

/** The RankMedal drawing with a check mark instead of the rank number. */
export function TestedMedal({
  level,
  size = 12,
  className,
}: Readonly<TestedMedalProps>) {
  return (
    <svg
      className={cn("tested-medal", `tested-medal--${level}`, className)}
      width={size}
      height={Math.round((size * 26) / 24)}
      viewBox="0 0 24 26"
      aria-hidden="true"
    >
      {level === "platinum" && (
        <defs>
          <linearGradient
            id="tested-medal-platinum"
            x1="0"
            y1="0"
            x2="1"
            y2="1"
          >
            <stop offset="0%" stopColor="#30edc5" />
            <stop offset="100%" stopColor="#16b195" />
          </linearGradient>
        </defs>
      )}
      <path className="tested-medal__ribbon" d="M6.5 1h4.5l2.2 7.5H8.7z" />
      <path className="tested-medal__ribbon" d="M17.5 1H13l-2.2 7.5h4.5z" />
      <circle className="tested-medal__disc" cx="12" cy="17" r="8" />
      <circle className="tested-medal__rim" cx="12" cy="17" r="6" />
      {level !== "untested" && (
        <path className="tested-medal__mark" d="M8.8 17.2l2.2 2.2 4.2-4.4" />
      )}
    </svg>
  );
}
