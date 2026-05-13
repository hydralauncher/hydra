import { useContext, useMemo } from "react";
import Skeleton from "react-loading-skeleton";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

import { gameDetailsContext } from "@renderer/context";
import { SidebarSection } from "../sidebar-section/sidebar-section";

import "./sidebar.scss";

type ControllerSupportStatus = "full" | "partial" | "none";
type ControllerSupportSource = "field" | "category" | null;

interface ControllerSupportResult {
  status: ControllerSupportStatus;
  source: ControllerSupportSource;
}

interface SteamCategory {
  id: number;
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

    return resolveControllerSupport(shopDetails as SteamDetailsWithController);
  }, [shop, shopDetails]);

  const isPending = shop === "steam" && isLoading && !shopDetails;

  if (shop !== "steam" || (!isPending && !controllerSupport)) {
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
            <div
              className={`controller-support__badge controller-support__badge--${status}`}
            >
              {copy.label}
            </div>

            {status !== "none" && (
              <div className="controller-support__icons" aria-hidden="true">
                <XboxIcon />
                <PlayStationIcon />
              </div>
            )}

            <p className="controller-support__description">
              {copy.description}
            </p>

            {controllerSupport?.source && (
              <small className="controller-support__source">
                {t(
                  controllerSupport.source === "field"
                    ? "controller_support_source_field"
                    : "controller_support_source_category"
                )}
              </small>
            )}
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
    return { status: "full", source: "field" };
  }

  if (details.controller_support === "partial") {
    return { status: "partial", source: "field" };
  }

  const categories = details.categories ?? [];

  if (categories.some(({ id }) => id === FULL_SUPPORT_CATEGORY_ID)) {
    return { status: "full", source: "category" };
  }

  if (categories.some(({ id }) => id === PARTIAL_SUPPORT_CATEGORY_ID)) {
    return { status: "partial", source: "category" };
  }

  return { status: "none", source: null };
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
        description: t("controller_support_none_description"),
      };
  }
}

function XboxIcon() {
  return (
    <svg
      className="controller-support__icon controller-support__icon--xbox"
      viewBox="0 0 50 50"
      width="40"
      height="40"
      role="img"
      aria-label="Xbox"
      focusable="false"
    >
      <path
        d="M 25 2 C 20.709 2 16.618563 3.2007813 13.226562 5.3007812 C 13.007563 5.3737813 12.629156 5.6617969 12.285156 5.9667969 C 15.330156 3.5477969 22.371734 8.3929375 24.427734 9.8359375 C 24.773734 10.078938 25.228219 10.078938 25.574219 9.8359375 C 27.630219 8.3929375 34.671797 3.5467969 37.716797 5.9667969 C 37.372797 5.6617969 36.993391 5.3737813 36.775391 5.3007812 C 33.382391 3.2007813 29.291 2 25 2 z M 11 8 C 9.403 8 8.2363281 9.3007812 8.2363281 9.3007812 C 4.4443281 13.400781 2.0507812 18.9 2.0507812 25 C 2.0507812 37.7 12.328 48 25 48 C 31.685 48 37.771891 45.1 41.962891 40.5 C 41.962891 40.5 41.464094 37.499609 38.371094 33.099609 C 34.912094 27.882609 27.905109 21.311922 25.662109 19.294922 C 25.279109 18.950922 24.708125 18.952781 24.328125 19.300781 C 22.638125 20.847781 18.277406 25.177781 17.316406 26.300781 C 15.021406 28.700781 8.6353281 36.299609 8.2363281 40.599609 C 8.2363281 40.599609 6.8386406 37.200391 9.9316406 29.400391 C 11.856641 24.714391 17.835375 17.747984 20.734375 14.708984 C 21.119375 14.305984 21.110125 13.669109 20.703125 13.287109 C 19.743125 12.388109 17.505281 10.812609 15.488281 9.5996094 C 14.092281 8.6996094 12.497 8.1 11 8 z M 38.689453 8 C 38.036453 8 33.794078 9.3428281 29.330078 13.298828 C 28.908078 13.672828 28.891203 14.325469 29.283203 14.730469 C 30.900203 16.401469 35.322656 20.681391 37.972656 24.900391 C 41.265656 30.300391 43.2605 34.6 42.0625 40.5 C 45.7545 36.4 48.050781 31 48.050781 25 C 47.950781 19 45.655281 13.500391 41.863281 9.4003906 C 41.763281 9.3003906 41.663453 9.1996094 41.564453 9.0996094 C 40.766453 8.1996094 39.587453 8 38.689453 8 z"
        fill="currentColor"
      />
    </svg>
  );
}

function PlayStationIcon() {
  return (
    <svg
      className="controller-support__icon controller-support__icon--playstation"
      viewBox="0 0 50 50"
      width="40"
      height="40"
      role="img"
      aria-label="PlayStation"
      focusable="false"
    >
      <path
        d="M 19.3125 4 C 19.011719 4 18.707031 3.988281 18.40625 4.1875 C 18.105469 4.386719 18 4.699219 18 5 L 18 41.59375 C 18 41.992188 18.289063 42.394531 18.6875 42.59375 L 26.6875 45 L 27 45 C 27.199219 45 27.394531 44.914063 27.59375 44.8125 C 27.894531 44.613281 28 44.300781 28 44 L 28 13.40625 C 28.601563 13.707031 29 14.300781 29 15 L 29 26.09375 C 29 26.394531 29.199219 26.804688 29.5 26.90625 C 29.699219 27.007813 31.199219 27.90625 34 27.90625 C 36.699219 27.90625 40 26.414063 40 19.3125 C 40 13.613281 36.8125 9.292969 31.3125 7.59375 Z M 17 26.40625 L 5.90625 30.40625 L 4.3125 31 C 1.613281 32.101563 0 33.886719 0 35.6875 C 0 39.488281 2.699219 41.6875 7.5 41.6875 C 10.101563 41.6875 13.300781 41.113281 17 39.8125 L 17 36 C 16.101563 36.300781 15.113281 36.699219 14.3125 37 C 12.710938 37.601563 11.5 37.8125 10.5 37.8125 C 9 37.8125 8.300781 37.300781 8 37 C 7.601563 36.699219 7.398438 36.3125 7.5 35.8125 C 7.601563 34.8125 8.800781 33.894531 11 33.09375 C 11.5 32.894531 14.898438 31.699219 17 31 Z M 36.5 28.90625 C 34.101563 29.007813 31.601563 29.394531 29 30.09375 L 29 34.6875 C 30.101563 34.289063 31.585938 33.800781 33.6875 33 C 38.488281 31.300781 40.492188 31.488281 41.09375 31.6875 C 42.292969 31.789063 42.800781 32.5 43 33 C 43.5 34.5 41.613281 35.1875 38.8125 36.1875 C 37.511719 36.6875 31.898438 38.6875 29 39.6875 L 29 44.3125 L 44.5 38.8125 L 45.6875 38.3125 C 47.6875 37.613281 50.199219 36.300781 50 34 C 49.898438 31.800781 47.210938 30.695313 45.3125 30.09375 C 42.511719 29.195313 39.5 28.804688 36.5 28.90625 Z"
        fill="currentColor"
      />
    </svg>
  );
}
