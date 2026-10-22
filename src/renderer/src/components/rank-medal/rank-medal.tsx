import cn from "classnames";
import { useTranslation } from "react-i18next";

import { getRankTier, isMedalTier } from "./rank-tier";
import "./rank-medal.scss";

const MEDAL_SHINE_STAGGER_SECONDS = 0.35;

export interface RankMedalProps {
  rank: number;
  highlighted?: boolean;
  className?: string;
}

export function RankMedal({
  rank,
  highlighted,
  className,
}: Readonly<RankMedalProps>) {
  const { t } = useTranslation("leaderboard");
  const tier = getRankTier(rank);

  if (!isMedalTier(tier)) {
    return (
      <span
        className={cn(
          "rank-medal__number",
          `rank-medal__number--${tier}`,
          { "rank-medal__number--highlighted": highlighted },
          className
        )}
      >
        {rank}
      </span>
    );
  }

  return (
    <span
      className={cn("rank-medal", `rank-medal--${tier}`, className)}
      style={
        {
          "--rank-medal-delay": `${rank * MEDAL_SHINE_STAGGER_SECONDS}s`,
        } as React.CSSProperties
      }
      role="img"
      aria-label={t(`medal_${tier}`)}
    >
      <svg
        className="rank-medal__icon"
        width="24"
        height="26"
        viewBox="0 0 24 26"
        aria-hidden="true"
      >
        <path className="rank-medal__ribbon" d="M6.5 1h4.5l2.2 7.5H8.7z" />
        <path className="rank-medal__ribbon" d="M17.5 1H13l-2.2 7.5h4.5z" />
        <circle className="rank-medal__disc" cx="12" cy="17" r="8" />
        <circle className="rank-medal__rim" cx="12" cy="17" r="6" />
        <text className="rank-medal__rank" x="12" y="21" textAnchor="middle">
          {rank}
        </text>
      </svg>
      <span className="rank-medal__shine" aria-hidden="true" />
    </span>
  );
}

export function RankFrameRing() {
  return (
    <span className="rank-frame__ring" aria-hidden="true">
      <span className="rank-frame__spinner" />
    </span>
  );
}
