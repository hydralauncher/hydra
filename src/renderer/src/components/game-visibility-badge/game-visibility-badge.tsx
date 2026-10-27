import { EyeClosedIcon, LockIcon } from "@primer/octicons-react";
import { useTranslation } from "react-i18next";
import { BADGE_TOOLTIP_ID } from "../badge-tooltip/badge-tooltip";
import "./game-visibility-badge.scss";

interface GameVisibilityBadgeProps {
  isHiddenFromOthers?: boolean;
  isConcealed?: boolean;
  variant?: "default" | "large";
}

export function GameVisibilityBadge({
  isHiddenFromOthers,
  isConcealed,
  variant = "default",
}: Readonly<GameVisibilityBadgeProps>) {
  const { t } = useTranslation("library");
  if (!isHiddenFromOthers && !isConcealed) return null;

  const description = isConcealed
    ? t("hidden_game_tooltip")
    : t("hidden_from_others_tooltip");

  return (
    <span
      className={`game-visibility-badge${variant === "large" ? " game-visibility-badge--large" : ""}`}
      data-tooltip-id={BADGE_TOOLTIP_ID}
      data-tooltip-content={description}
      aria-label={description}
      role="img"
    >
      {isConcealed ? <LockIcon size={11} /> : <EyeClosedIcon size={11} />}
    </span>
  );
}
