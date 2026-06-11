import { useId, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Tooltip } from "react-tooltip";

import {
  getRegionsFromSkus,
  getSkuRegionFlag,
  type SkuRegion,
} from "@renderer/helpers";
import { SidebarSection } from "../sidebar-section/sidebar-section";

import "./launchbox-details-section.scss";

const REGION_TRANSLATION_KEYS: Record<SkuRegion, string> = {
  US: "region_us",
  EU: "region_eu",
  JP: "region_jp",
  KR: "region_kr",
  ASIA: "region_asia",
};

interface Props {
  platform?: string;
  genres?: string[];
  skus?: string[];
}

export function LaunchboxDetailsSection({
  platform,
  genres,
  skus,
}: Readonly<Props>) {
  const { t } = useTranslation("game_details");
  const tooltipId = useId();

  const regions = useMemo(
    () => (skus && skus.length > 0 ? getRegionsFromSkus(skus) : []),
    [skus]
  );

  const hasContent =
    Boolean(platform) || (genres && genres.length > 0) || regions.length > 0;

  if (!hasContent) return null;

  return (
    <SidebarSection title={t("details")}>
      <div className="launchbox-details">
        {platform && (
          <div className="launchbox-details__row">
            <span className="launchbox-details__label">{t("platform")}</span>
            <span className="launchbox-details__value">{platform}</span>
          </div>
        )}

        {genres && genres.length > 0 && (
          <div className="launchbox-details__row">
            <span className="launchbox-details__label">{t("genres")}</span>
            <span className="launchbox-details__value">
              {genres.join(", ")}
            </span>
          </div>
        )}

        {regions.length > 0 && (
          <div className="launchbox-details__row">
            <span className="launchbox-details__label">{t("regions")}</span>
            <span className="launchbox-details__flags">
              {regions.map((region) => {
                const name = t(REGION_TRANSLATION_KEYS[region]);
                return (
                  <img
                    key={region}
                    src={getSkuRegionFlag(region)}
                    alt={name}
                    className="launchbox-details__flag"
                    data-tooltip-id={tooltipId}
                    data-tooltip-content={name}
                  />
                );
              })}
            </span>
          </div>
        )}
      </div>
      <Tooltip id={tooltipId} />
    </SidebarSection>
  );
}
