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
  availableShops?: readonly string[];
  hasActiveSteamImport?: boolean;
  hasActiveEpicImport?: boolean;
  variant?: "cover" | "large" | "sidebar";
  className?: string;
}

export function SteamLibraryBadge({
  variant = "cover",
  source = "steam",
  hasActiveSteamImport = false,
  hasActiveEpicImport = false,
  className,
}: SteamLibraryBadgeProps) {
  const { t } = useTranslation("library");
  const tooltipId = useId();
  const hasBothImports = hasActiveSteamImport && hasActiveEpicImport;
  const badgeSource = hasActiveSteamImport
    ? "steam"
    : hasActiveEpicImport
      ? "epic"
      : source;
  let labelKey: string;
  if (hasActiveSteamImport && hasActiveEpicImport) {
    labelKey = "imported_from_steam_and_epic";
  } else if (hasActiveSteamImport) {
    labelKey = "imported_from_steam";
  } else if (hasActiveEpicImport) {
    labelKey = "imported_from_epic";
  } else {
    labelKey =
      badgeSource === "epic" ? "imported_from_epic" : "imported_from_steam";
  }
  const label = t(labelKey);
  const classes = [
    "steam-library-badge",
    `steam-library-badge--${variant}`,
    hasBothImports && "steam-library-badge--multiple",
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
        {badgeSource === "epic" ? (
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
        {hasBothImports && (
          <span className="steam-library-badge__additional" aria-hidden="true">
            +
          </span>
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
