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
  variant?: "cover" | "large" | "sidebar";
  className?: string;
}

export function SteamLibraryBadge({
  variant = "cover",
  className,
}: SteamLibraryBadgeProps) {
  const { t } = useTranslation("library");
  const tooltipId = useId();
  const label = t("imported_from_steam");
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
        <SteamIcon
          size={variant === "sidebar" ? 8 : variant === "large" ? 16 : 15}
        />
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
