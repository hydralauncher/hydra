import EpicLogo from "@renderer/assets/epic-integration-logo.svg?react";
import { useTranslation } from "react-i18next";

import SteamLogo from "@renderer/assets/bi-steam.svg?react";
import { BADGE_TOOLTIP_ID } from "../badge-tooltip/badge-tooltip";

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
    <span
      className={classes}
      data-tooltip-id={BADGE_TOOLTIP_ID}
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
  );
}
