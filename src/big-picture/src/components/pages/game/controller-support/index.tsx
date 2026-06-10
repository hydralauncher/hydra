import type { GameShop, ShopDetails } from "@types";
import type { FocusOverrides } from "../../../../services";
import { FocusItem, Typography } from "../../../common";
import XboxLogo from "@renderer/assets/Xbox Logo.svg?react";
import PlayStationLogo from "@renderer/assets/PlayStation Logo Wordmark.svg?react";

type ControllerSupportStatus = "full" | "partial" | "none";

interface ControllerSupportResult {
  status: ControllerSupportStatus;
}

export interface ControllerSupportBoxProps {
  shop?: GameShop;
  shopDetails: ShopDetails;
  focusId?: string;
  focusNavigationOverrides?: FocusOverrides;
  focusNavigationOrder?: number;
}

interface StatusCopy {
  label: string;
  description: string;
}

const FULL_SUPPORT_CATEGORY_ID = 28;
const PARTIAL_SUPPORT_CATEGORY_ID = 18;

export function ControllerSupportBox({
  shop,
  shopDetails,
  focusId,
  focusNavigationOverrides,
  focusNavigationOrder,
}: Readonly<ControllerSupportBoxProps>) {
  if (shop !== "steam") return null;

  const controllerSupport = resolveControllerSupport(shopDetails);

  if (controllerSupport.status === "none") return null;

  const copy = getStatusCopy(controllerSupport.status);

  return (
    <FocusItem
      id={focusId}
      navigationOverrides={focusNavigationOverrides}
      navigationOrder={focusNavigationOrder}
      asChild
    >
      <section
        className="game-page__sidebar-section game-page__controller-support"
        aria-label="Controller Support"
      >
        <div className="game-page__controller-support-title">
          <Typography>Controller Support</Typography>
        </div>

        <div className="game-page__controller-support-row">
          <div className="game-page__controller-support-meta">
            <div className="game-page__controller-support-icons" aria-hidden>
              <XboxLogo
                className="game-page__controller-support-icon game-page__controller-support-icon--xbox"
                focusable="false"
              />
            </div>
            <Typography className="game-page__controller-support-label">
              Xbox Controller
            </Typography>
          </div>

          <Typography className="game-page__controller-support-value">
            {copy.label}
          </Typography>
        </div>

        <div className="game-page__controller-support-row">
          <div className="game-page__controller-support-meta">
            <div className="game-page__controller-support-icons" aria-hidden>
              <PlayStationLogo
                className="game-page__controller-support-icon game-page__controller-support-icon--playstation"
                focusable="false"
              />
            </div>
            <Typography className="game-page__controller-support-label">
              PlayStation Controller
            </Typography>
          </div>

          <Typography className="game-page__controller-support-value">
            {copy.label}
          </Typography>
        </div>

        <div className="game-page__controller-support-row game-page__controller-support-row--description">
          <Typography className="game-page__controller-support-description">
            {copy.description}
          </Typography>
        </div>
      </section>
    </FocusItem>
  );
}

function resolveControllerSupport(
  details: ShopDetails
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

function getStatusCopy(status: ControllerSupportStatus): StatusCopy {
  if (status === "full") {
    return {
      label: "Full support",
      description: "Plays great with Xbox and PlayStation controllers.",
    };
  }

  if (status === "partial") {
    return {
      label: "Partial support",
      description: "Some menus may require a keyboard and mouse.",
    };
  }

  return {
    label: "No official support",
    description: "",
  };
}
