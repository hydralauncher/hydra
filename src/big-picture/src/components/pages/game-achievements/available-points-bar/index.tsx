import { MedalIcon } from "@phosphor-icons/react";

export interface AvailablePointsBarProps {
  earnedPoints: number;
  totalPoints: number;
}

export function AvailablePointsBar({
  earnedPoints,
  totalPoints,
}: Readonly<AvailablePointsBarProps>) {
  if (totalPoints <= 0) return null;

  const formatter = new Intl.NumberFormat("en");

  return (
    <div className="game-achievements-page__points-bar">
      <span className="game-achievements-page__points-label">
        Earned points
      </span>
      <div className="game-achievements-page__points-value">
        <MedalIcon size={16} weight="fill" />
        <span>
          {formatter.format(earnedPoints)} / {formatter.format(totalPoints)}
        </span>
      </div>
    </div>
  );
}
