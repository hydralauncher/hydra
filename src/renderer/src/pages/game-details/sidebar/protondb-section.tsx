import cn from "classnames";
import { LinkExternalIcon, StarIcon } from "@primer/octicons-react";
import { Link } from "@renderer/components/link/link";
import Skeleton, { SkeletonTheme } from "react-loading-skeleton";
import { useTranslation } from "react-i18next";
import type { ProtonDBData } from "@types";
import ProtonDBLogo from "@renderer/assets/protondb-logo.svg?url";
import SteamDeckLogo from "@renderer/assets/steam-deck-logo.svg?url";
import { SidebarSection } from "../sidebar-section/sidebar-section";
import "./sidebar.scss";

const protonTierTranslation: Record<string, string> = {
  borked: "protondb_tier_borked",
  bronze: "protondb_tier_bronze",
  silver: "protondb_tier_silver",
  gold: "protondb_tier_gold",
  platinum: "protondb_tier_platinum",
};

const deckCompatibilityTranslation: Record<string, string> = {
  verified: "deck_verified",
  playable: "deck_playable",
  unsupported: "deck_unsupported",
  unknown: "deck_unknown",
};

export interface ProtonDBSectionProps {
  protonDBData: ProtonDBData | null;
  isLoading: boolean;
  objectId: string;
}

export function ProtonDBSection({
  protonDBData,
  isLoading,
  objectId,
}: ProtonDBSectionProps) {
  const { t } = useTranslation(["game_details", "catalogue"]);

  const tier = protonDBData?.tier?.toLowerCase().trim() ?? null;
  const tierKey = tier ? protonTierTranslation[tier] : null;
  const isKnownTier = Boolean(tierKey);
  const tierLabel = tierKey ? t(tierKey) : "-";

  const scoreLabel =
    typeof protonDBData?.score === "number"
      ? `${Math.round(protonDBData.score * 100)}%`
      : "-";

  const deckKey = protonDBData?.deckCompatibility
    ? deckCompatibilityTranslation[protonDBData.deckCompatibility]
    : null;

  if (!protonDBData && !isLoading) return null;

  return (
    <SkeletonTheme baseColor="#1c1c1c" highlightColor="#444">
      <SidebarSection title={t("catalogue:protondb")}>
        <div className="protondb__content">
          {protonDBData ? (
            <>
              <div className="protondb__section">
                <div className="protondb__category">
                  <p className="protondb__category-title">
                    <img
                      src={ProtonDBLogo}
                      alt=""
                      className="protondb__proton-icon"
                      aria-hidden="true"
                    />
                    {t("protondb_tier")}
                  </p>

                  <span
                    className={cn(
                      "protondb__tier-badge",
                      isKnownTier && `protondb__tier-badge--${tier}`
                    )}
                  >
                    <span>{tierLabel}</span>
                  </span>
                </div>

                <div className="protondb__category">
                  <p className="protondb__category-title">
                    <img
                      src={SteamDeckLogo}
                      alt=""
                      className="protondb__steamdeck-icon"
                      aria-hidden="true"
                    />
                    {t("deck_compatibility")}
                  </p>
                  <p className="protondb__value">
                    {deckKey ? t(deckKey) : t("deck_unknown")}
                  </p>
                </div>

                <div className="protondb__category">
                  <p className="protondb__category-title">
                    <StarIcon size={18} aria-hidden="true" />
                    {t("protondb_score")}
                  </p>
                  <p className="protondb__value">{scoreLabel}</p>
                </div>
              </div>

              <Link
                to={`https://www.protondb.com/app/${objectId}`}
                className="protondb__view-link"
              >
                {t("view_on_protondb")}
                <LinkExternalIcon size={12} aria-hidden="true" />
              </Link>
            </>
          ) : (
            <>
              <div className="protondb__section">
                {Array.from({ length: 3 }).map((_, index) => (
                  <div key={index} className="protondb__category">
                    <Skeleton className="protondb__title-skeleton" />
                    <Skeleton className="protondb__value-skeleton" />
                  </div>
                ))}
              </div>

              <Skeleton className="protondb__link-skeleton" />
            </>
          )}
        </div>
      </SidebarSection>
    </SkeletonTheme>
  );
}
