import cn from "classnames";
import ProtonDBLogo from "@renderer/assets/protondb-logo.svg?url";
import { useTranslation } from "react-i18next";

interface ProtonDBBadgeProps {
  badge: string;
}

export function ProtonDBBadge({ badge }: ProtonDBBadgeProps) {
  const { t } = useTranslation("game_details");

  const tierTranslation: Record<string, string> = {
    borked: "protondb_tier_borked",
    bronze: "protondb_tier_bronze",
    silver: "protondb_tier_silver",
    gold: "protondb_tier_gold",
    platinum: "protondb_tier_platinum",
  };

  const label = t(tierTranslation[badge] ?? "protondb_tier_unknown");

  return (
    <div className="game-item__compatibility-badge-group">
      <span
        className={cn(
          "game-item__compatibility-badge",
          `game-item__compatibility-badge--${badge}`
        )}
        title={t("protondb_badge_title", { tier: label })}
      >
        <img
          src={ProtonDBLogo}
          alt=""
          aria-hidden="true"
          className="game-item__compatibility-logo"
          width={12}
          height={12}
          loading="lazy"
        />
        <span>{label}</span>
      </span>
    </div>
  );
}
