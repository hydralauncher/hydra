import { useContext } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ChevronRightIcon } from "@primer/octicons-react";

import { gameDetailsContext } from "@renderer/context";
import { useAppSelector } from "@renderer/hooks";
import retroAchievementsLogo from "@renderer/assets/icons/retroachievements.png";

import "./retro-achievements-connect-banner.scss";

export function RetroAchievementsConnectBanner() {
  const { t } = useTranslation("achievement");
  const navigate = useNavigate();

  const { shop, shopDetails } = useContext(gameDetailsContext);
  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const isRetroAchievementsGame =
    shop === "launchbox" && Boolean(shopDetails?.retroAchievementsGameId);
  const isConnected = Boolean(userPreferences?.retroAchievementsWebApiKey);

  if (!isRetroAchievementsGame || isConnected) return null;

  return (
    <button
      type="button"
      className="retro-achievements-connect-banner"
      onClick={() => navigate("/settings?tab=integrations")}
    >
      <img
        src={retroAchievementsLogo}
        alt=""
        className="retro-achievements-connect-banner__logo"
      />
      <span className="retro-achievements-connect-banner__text">
        {t("connect_retroachievements_prompt")}
      </span>
      <ChevronRightIcon size={16} />
    </button>
  );
}
