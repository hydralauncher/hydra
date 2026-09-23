import { EyeClosedIcon, LockIcon } from "@primer/octicons-react";
import { useTranslation } from "react-i18next";
import "./game-visibility-badge.scss";

interface GameVisibilityBadgeProps {
  hide?: boolean;
  isHidden?: boolean;
}

export function GameVisibilityBadge({
  hide,
  isHidden,
}: Readonly<GameVisibilityBadgeProps>) {
  const { t } = useTranslation("library");
  if (!hide && !isHidden) return null;

  const description = isHidden
    ? t("hidden_game_tooltip")
    : t("hidden_from_others_tooltip");

  return (
    <span
      className="game-visibility-badge"
      title={description}
      aria-label={description}
    >
      {isHidden ? <LockIcon size={14} /> : <EyeClosedIcon size={14} />}
    </span>
  );
}
