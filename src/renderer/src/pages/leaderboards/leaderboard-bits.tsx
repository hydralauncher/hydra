import { useId } from "react";
import cn from "classnames";
import Skeleton from "react-loading-skeleton";
import { useTranslation } from "react-i18next";

import { Button } from "@renderer/components";

const ROW_SKELETON_ROWS = 5;
const ROW_SKELETON_KEYS = Array.from(
  { length: ROW_SKELETON_ROWS },
  (_, index) => `row-skeleton-${index}`
);

export function RankDelta({ delta }: Readonly<{ delta: number | null }>) {
  const { t } = useTranslation("leaderboards");
  if (delta === null) return null;

  let label = "–";
  if (delta > 0) label = `▲${delta}`;
  else if (delta < 0) label = `▼${Math.abs(delta)}`;

  return (
    <span
      className={cn("rank-delta", {
        "rank-delta--up": delta > 0,
        "rank-delta--down": delta < 0,
      })}
      aria-label={t("delta_label", { count: delta })}
    >
      {label}
    </span>
  );
}

export function StreakFlame({
  size = 16,
  flicker = false,
  gradient = true,
  label,
}: Readonly<{
  size?: number;
  flicker?: boolean;
  gradient?: boolean;
  label?: string;
}>) {
  const gradientId = useId();

  return (
    <>
      <svg
        className={cn("streak-flame", { "streak-flame--flicker": flicker })}
        width={size}
        height={size}
        viewBox="0 0 16 16"
        aria-hidden="true"
      >
        {gradient && (
          <defs>
            <linearGradient id={gradientId} x1="0" y1="1" x2="1" y2="0">
              <stop offset="0%" stopColor="#22c7ee" />
              <stop offset="100%" stopColor="#b05cff" />
            </linearGradient>
          </defs>
        )}
        <path
          fill={gradient ? `url(#${gradientId})` : undefined}
          d="M8 14c-2.8 0-4.5-1.9-4.5-4.3 0-2.6 2.2-3.9 2.7-6.7 1.6 1 2.3 2.4 2.3 3.6.8-.4 1.3-1.2 1.4-2 1.6 1.3 2.6 3 2.6 5.1C12.5 12.1 10.8 14 8 14z"
        />
      </svg>
      {label && <span className="leaderboards__sr-only">{label}</span>}
    </>
  );
}

export function BlockMessage({
  icon,
  title,
  description,
  action,
}: Readonly<{
  icon?: React.ReactNode;
  title: string;
  description?: string | null;
  action?: React.ReactNode;
}>) {
  return (
    <div className="leaderboards__message">
      {icon}
      <p className="leaderboards__message-title">{title}</p>
      {description && (
        <p className="leaderboards__message-description">{description}</p>
      )}
      {action}
    </div>
  );
}

export function BlockError({ onRetry }: Readonly<{ onRetry: () => void }>) {
  const { t } = useTranslation("leaderboards");

  return (
    <BlockMessage
      title={t("error_title")}
      description={t("error_description")}
      action={
        <Button theme="outline" size="small" onClick={onRetry}>
          {t("retry")}
        </Button>
      }
    />
  );
}

export function BoardSkeleton() {
  return (
    <div className="leaderboards__skeleton" aria-busy="true">
      <div className="leaderboard-podium">
        {[260, 288, 240].map((height) => (
          <Skeleton
            key={height}
            height={height}
            className="leaderboards__skeleton-podium"
          />
        ))}
      </div>
      {ROW_SKELETON_KEYS.map((key) => (
        <Skeleton key={key} className="leaderboards__skeleton-row" />
      ))}
    </div>
  );
}
