import { rampColor } from "./gamification-colors";
import "./xp-bar.scss";

export interface XpBarProps {
  xp: number;
  xpToNextLevel: number | null;
  className?: string;
}

const FILL_BACKGROUND = `linear-gradient(90deg, ${rampColor(0)}, ${rampColor(0.55)}, ${rampColor(1)})`;

export function XpBar({ xp, xpToNextLevel, className }: Readonly<XpBarProps>) {
  const percentage =
    xpToNextLevel === null ? 100 : Math.min(100, (xp / xpToNextLevel) * 100);

  return (
    <div className={`xp-bar ${className ?? ""}`} aria-hidden="true">
      <div
        className="xp-bar__fill"
        style={{ width: `${percentage}%`, background: FILL_BACKGROUND }}
      />
    </div>
  );
}
