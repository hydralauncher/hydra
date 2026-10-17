import { EyeClosedIcon, LockIcon } from "@primer/octicons-react";
import { useId } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Tooltip } from "react-tooltip";
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
  const tooltipId = useId();
  if (!isHiddenFromOthers && !isConcealed) return null;

  const description = isConcealed
    ? t("hidden_game_tooltip")
    : t("hidden_from_others_tooltip");

  return (
    <>
      <span
        className={`game-visibility-badge${variant === "large" ? " game-visibility-badge--large" : ""}`}
        data-tooltip-id={tooltipId}
        data-tooltip-content={description}
        aria-label={description}
        role="img"
      >
        {isConcealed ? <LockIcon size={11} /> : <EyeClosedIcon size={11} />}
      </span>
      {createPortal(
        <Tooltip
          id={tooltipId}
          place="top"
          positionStrategy="fixed"
          style={{ zIndex: 9999, maxWidth: 280 }}
        />,
        document.body
      )}
    </>
  );
}
