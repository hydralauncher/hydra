import { useContext, useMemo } from "react";
import Skeleton from "react-loading-skeleton";
import { useTranslation } from "react-i18next";
import {
  type ControllerSupportDetails,
  getControllerSupportCopyKeys,
  resolveControllerSupport,
} from "@shared";

import { gameDetailsContext } from "@renderer/context";
import { SidebarSection } from "../sidebar-section/sidebar-section";
import XboxLogo from "@renderer/assets/Xbox Logo.svg?react";
import PlayStationLogo from "@renderer/assets/PlayStation Logo Wordmark.svg?react";

import "./sidebar.scss";

export function ControllerSupportSection() {
  const { t } = useTranslation("game_details");
  const { shop, shopDetails, isLoading } = useContext(gameDetailsContext);

  const controllerSupport = useMemo(() => {
    if (!shopDetails || shop !== "steam") return null;

    const details = shopDetails as ControllerSupportDetails;
    return resolveControllerSupport(details);
  }, [shop, shopDetails]);

  const isPending = shop === "steam" && isLoading && !shopDetails;

  if (
    shop !== "steam" ||
    (!isPending && (!controllerSupport || controllerSupport === "none"))
  ) {
    return null;
  }

  const status = controllerSupport ?? "none";
  const copy = getControllerSupportCopyKeys(status);

  return (
    <SidebarSection title={t("controller_support")}>
      <div className="controller-support">
        {isPending ? (
          <div className="controller-support__skeleton">
            <Skeleton height={32} width="70%" />
            <Skeleton height={16} width="90%" />
            <Skeleton height={16} width="60%" />
          </div>
        ) : (
          <>
            {status !== "none" && (
              <div className="controller-support__icons" aria-hidden="true">
                <XboxIcon />
                <PlayStationIcon />
              </div>
            )}

            <div
              className={`controller-support__badge controller-support__badge--${status}`}
            >
              {t(copy.labelKey)}
            </div>

            <p className="controller-support__description">
              {copy.descriptionKey ? t(copy.descriptionKey) : ""}
            </p>
          </>
        )}
      </div>
    </SidebarSection>
  );
}

function XboxIcon() {
  return (
    <XboxLogo
      className="controller-support__icon controller-support__icon--xbox"
      role="img"
      aria-label="Xbox"
      focusable="false"
    />
  );
}

function PlayStationIcon() {
  return (
    <PlayStationLogo
      className="controller-support__icon controller-support__icon--playstation"
      role="img"
      aria-label="PlayStation"
      focusable="false"
    />
  );
}
