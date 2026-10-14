import EpicLogo from "@renderer/assets/epic-integration-logo.svg?react";
import { useId } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Tooltip } from "react-tooltip";

import SteamLogo from "@renderer/assets/bi-steam.svg?react";

import "./steam-library-badge.scss";

interface SteamIconProps {
  size?: number;
  className?: string;
}

export function SteamIcon({ size = 14, className }: SteamIconProps) {
  return (
    <SteamLogo
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
    />
  );
}

interface SteamLibraryBadgeProps {
  source?: "steam" | "epic";
  variant?: "cover" | "large" | "sidebar";
  className?: string;
}

export function SteamLibraryBadge({
  variant = "cover",
  source = "steam",
  className,
}: SteamLibraryBadgeProps) {
  const { t } = useTranslation("library");
  const tooltipId = useId();
  const label = t(
    source === "epic" ? "imported_from_epic" : "imported_from_steam"
  );
  const classes = [
    "steam-library-badge",
    `steam-library-badge--${variant}`,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      <span
        className={classes}
        data-tooltip-id={tooltipId}
        data-tooltip-content={label}
        aria-label={label}
        role="img"
      >
        {source === "epic" ? (
          <EpicLogo
            width={variant === "sidebar" ? 8 : 13}
            height={variant === "sidebar" ? 8 : 13}
            aria-hidden="true"
          />
        ) : (
          <SteamIcon
            size={variant === "sidebar" ? 8 : variant === "large" ? 13 : 12}
          />
        )}
      </span>
      {createPortal(
        <Tooltip
          id={tooltipId}
          place="top"
          positionStrategy="fixed"
          style={{ zIndex: 9999 }}
        />,
        document.body
      )}
    </>
  );
}
