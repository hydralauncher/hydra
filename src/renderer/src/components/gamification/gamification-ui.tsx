import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useAppSelector, useFormat } from "@renderer/hooks";
import { PIXEL_ICONS, type PixelIconName } from "./gamification-art";
import { BAYER_4X4, DIM_COLOR } from "./gamification-colors";
import { BoostIcon, CoinIcon } from "./gamification-icons";
import { PixelArt } from "./pixel-art";
import "./gamification-ui.scss";

const INK_COLOR = "#f0f1f7";
const SPINNER_COLOR = "#3a3b40";

export function PixelIcon({
  name,
  size = 16,
  isDim = false,
}: Readonly<{ name: PixelIconName; size?: number; isDim?: boolean }>) {
  const colors = useMemo(
    () => ({ "#": isDim ? DIM_COLOR : INK_COLOR }),
    [isDim]
  );
  return <PixelArt rows={PIXEL_ICONS[name]} colors={colors} size={size} />;
}

// Dotted disc with a hollow check (prototype's "done" icon).
const DONE_ROWS = (() => {
  const size = 16;
  const center = 7.5;
  const check = new Set<string>();
  [
    [3, 8],
    [4, 9],
    [5, 10],
    [6, 11],
    [7, 10],
    [8, 9],
    [9, 8],
    [10, 7],
    [11, 6],
    [12, 5],
  ].forEach(([x, y]) => {
    check.add(`${x},${y}`);
    check.add(`${x},${y - 1}`);
  });

  const rows: string[] = [];
  for (let y = 0; y < size; y++) {
    let row = "";
    for (let x = 0; x < size; x++) {
      const isInside = (x - center) ** 2 + (y - center) ** 2 <= 7.6 ** 2;
      if (!isInside || check.has(`${x},${y}`)) {
        row += ".";
        continue;
      }
      const shade = 1 - Math.max(0, (x + y - 12) / 18) * 0.7;
      row += BAYER_4X4[y % 4][x % 4] < shade * 16 ? "#" : ".";
    }
    rows.push(row);
  }
  return rows;
})();

export function DoneIcon({
  size = 16,
  isDim = false,
}: Readonly<{ size?: number; isDim?: boolean }>) {
  const colors = useMemo(
    () => ({ "#": isDim ? DIM_COLOR : INK_COLOR }),
    [isDim]
  );
  return <PixelArt rows={DONE_ROWS} colors={colors} size={size} />;
}

export function ProgressIcon({ size = 16 }: Readonly<{ size?: number }>) {
  const center = size / 2;
  const rays = Array.from({ length: 8 }, (_, index) => {
    const angle = ((index * 45 - 90) * Math.PI) / 180;
    return {
      x1: center + Math.cos(angle) * size * 0.2,
      y1: center + Math.sin(angle) * size * 0.2,
      x2: center + Math.cos(angle) * size * 0.42,
      y2: center + Math.sin(angle) * size * 0.42,
    };
  });

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-hidden="true"
    >
      {rays.map((ray) => (
        <line
          key={`${ray.x2}-${ray.y2}`}
          {...ray}
          stroke={SPINNER_COLOR}
          strokeWidth={size * 0.1}
          strokeLinecap="round"
        />
      ))}
    </svg>
  );
}

export function RewardChips({
  xp,
  coins,
  className,
}: Readonly<{ xp: number; coins: number; className?: string }>) {
  const { t } = useTranslation("user_profile");
  const { formatNumber } = useFormat();
  const boostPercent = useAppSelector(
    (state) => state.gamification.missions?.cloudBoostPercent ?? null
  );

  return (
    <span className={`reward-chips ${className ?? ""}`}>
      {xp > 0 && (
        <span className="reward-chips__xp">+{formatNumber(xp)} XP</span>
      )}
      {coins > 0 && (
        <span className="reward-chips__coins">
          <CoinIcon />+{formatNumber(coins)}
        </span>
      )}
      {boostPercent !== null && (xp > 0 || coins > 0) && (
        <span
          className="reward-chips__boost"
          title={t("cloud_boost_chip", { percent: boostPercent })}
        >
          <BoostIcon />+{boostPercent}%
        </span>
      )}
    </span>
  );
}
