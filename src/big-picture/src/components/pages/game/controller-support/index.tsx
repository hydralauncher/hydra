import type { GameShop, ShopDetails } from "@types";
import { useTranslation } from "react-i18next";
import {
  getControllerSupportCopyKeys,
  resolveControllerSupport,
} from "@shared";
import type { FocusOverrides } from "../../../../services";
import { FocusItem, Typography } from "../../../common";
import XboxLogo from "@renderer/assets/Xbox Logo.svg?react";
import PlayStationLogo from "@renderer/assets/PlayStation Logo Wordmark.svg?react";

export interface ControllerSupportBoxProps {
  shop?: GameShop;
  shopDetails: ShopDetails;
  focusId?: string;
  focusNavigationOverrides?: FocusOverrides;
  focusNavigationOrder?: number;
}

export function ControllerSupportBox({
  shop,
  shopDetails,
  focusId,
  focusNavigationOverrides,
  focusNavigationOrder,
}: Readonly<ControllerSupportBoxProps>) {
  const { t } = useTranslation("game_details");

  if (shop !== "steam") return null;

  const controllerSupport = resolveControllerSupport(shopDetails);

  if (controllerSupport === "none") return null;

  const copy = getControllerSupportCopyKeys(controllerSupport);
  const title = t("controller_support");

  return (
    <FocusItem
      id={focusId}
      navigationOverrides={focusNavigationOverrides}
      navigationOrder={focusNavigationOrder}
      asChild
    >
      <section
        className="game-page__sidebar-section game-page__controller-support"
        aria-label={title}
      >
        <div className="game-page__controller-support-title">
          <Typography>{title}</Typography>
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
              {t("controller_support_xbox_label")}
            </Typography>
          </div>

          <Typography className="game-page__controller-support-value">
            {t(copy.labelKey)}
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
              {t("controller_support_playstation_label")}
            </Typography>
          </div>

          <Typography className="game-page__controller-support-value">
            {t(copy.labelKey)}
          </Typography>
        </div>

        <div className="game-page__controller-support-row game-page__controller-support-row--description">
          <Typography className="game-page__controller-support-description">
            {copy.descriptionKey ? t(copy.descriptionKey) : ""}
          </Typography>
        </div>
      </section>
    </FocusItem>
  );
}
