import { EyeClosedIcon, LockIcon } from "@primer/octicons-react";
import { useTranslation } from "react-i18next";
import "./game-visibility-badge.scss";

interface GameVisibilityBadgeProps {
  isHiddenFromOthers?: boolean;
  isConcealed?: boolean;
}

export function GameVisibilityBadge({
  isHiddenFromOthers,
  isConcealed,
}: Readonly<GameVisibilityBadgeProps>) {
  const { t } = useTranslation("library");
  if (!isHiddenFromOthers && !isConcealed) return null;

  const description = isConcealed
    ? t("hidden_game_tooltip")
    : t("hidden_from_others_tooltip");

  return (
    <span
      className="game-visibility-badge"
      title={description}
      aria-label={description}
    >
      {isConcealed ? <LockIcon size={14} /> : <EyeClosedIcon size={14} />}
    </span>
  );
}
