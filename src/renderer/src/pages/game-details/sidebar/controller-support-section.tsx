import { useContext, useMemo } from "react";
import Skeleton from "react-loading-skeleton";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { SteamCategory } from "@types";

import { gameDetailsContext } from "@renderer/context";
import { SidebarSection } from "../sidebar-section/sidebar-section";
import XboxLogo from "@renderer/assets/Xbox Logo.svg?react";
import PlayStationLogo from "@renderer/assets/PlayStation Logo Wordmark.svg?react";

import "./sidebar.scss";

type ControllerSupportStatus = "full" | "partial" | "none";

interface ControllerSupportResult {
  status: ControllerSupportStatus;
}

interface SteamDetailsWithController {
  controller_support?: "full" | "partial";
  categories?: SteamCategory[];
}

interface StatusCopy {
  label: string;
  description: string;
}

const FULL_SUPPORT_CATEGORY_ID = 28;
const PARTIAL_SUPPORT_CATEGORY_ID = 18;

export function ControllerSupportSection() {
  const { t } = useTranslation("game_details");
  const { shop, shopDetails, isLoading } = useContext(gameDetailsContext);

  const controllerSupport = useMemo(() => {
    if (!shopDetails || shop !== "steam") return null;

    const details = shopDetails as SteamDetailsWithController;
    return resolveControllerSupport(details);
  }, [shop, shopDetails]);

  const isPending = shop === "steam" && isLoading && !shopDetails;

  if (
    shop !== "steam" ||
    (!isPending && (!controllerSupport || controllerSupport.status === "none"))
  ) {
    return null;
  }

  const status = controllerSupport?.status ?? "none";
  const copy = getStatusCopy(status, t);

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
              {copy.label}
            </div>

            <p className="controller-support__description">
              {copy.description}
            </p>
          </>
        )}
      </div>
    </SidebarSection>
  );
}

function resolveControllerSupport(
  details: SteamDetailsWithController
): ControllerSupportResult {
  if (details.controller_support === "full") {
    return { status: "full" };
  }

  if (details.controller_support === "partial") {
    return { status: "partial" };
  }

  const categories = details.categories ?? [];

  if (categories.some(({ id }) => id === FULL_SUPPORT_CATEGORY_ID)) {
    return { status: "full" };
  }

  if (categories.some(({ id }) => id === PARTIAL_SUPPORT_CATEGORY_ID)) {
    return { status: "partial" };
  }

  return { status: "none" };
}

function getStatusCopy(
  status: ControllerSupportStatus,
  t: TFunction<"game_details">
): StatusCopy {
  switch (status) {
    case "full":
      return {
        label: t("controller_support_full_label"),
        description: t("controller_support_full_description"),
      };
    case "partial":
      return {
        label: t("controller_support_partial_label"),
        description: t("controller_support_partial_description"),
      };
    default:
      return {
        label: t("controller_support_none_label"),
        description: "",
      };
  }
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
