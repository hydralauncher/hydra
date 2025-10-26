import { useContext, useEffect, useState } from "react";
import type {
  HowLongToBeatCategory,
  SteamAppDetails,
  UserAchievement,
} from "@types";
import { useTranslation } from "react-i18next";
import { Button, Link, StarRating } from "@renderer/components";

import { gameDetailsContext } from "@renderer/context";
import { useDate, useFormat, useUserDetails } from "@renderer/hooks";
import {
  CloudOfflineIcon,
  DownloadIcon,
  LockIcon,
  PeopleIcon,
  StarIcon,
} from "@primer/octicons-react";
import { HowLongToBeatSection } from "./how-long-to-beat-section";
import { SidebarSection } from "../sidebar-section/sidebar-section";
import { buildGameAchievementPath } from "@renderer/helpers";
import { useSubscription } from "@renderer/hooks/use-subscription";
import "./sidebar.scss";
import { GameLanguageSection } from "./game-language-section";

const achievementsPlaceholder: UserAchievement[] = [
  {
    displayName: "Timber!!",
    name: "1",
    hidden: false,
    description: "Chop down your first tree.",
    icon: "https://cdn.akamai.steamstatic.com/steamcommunity/public/images/apps/105600/0fbb33098c9da39d1d4771d8209afface9c46e81.jpg",
    icongray:
      "https://cdn.akamai.steamstatic.com/steamcommunity/public/images/apps/105600/0fbb33098c9da39d1d4771d8209afface9c46e81.jpg",
    unlocked: true,
    unlockTime: Date.now(),
  },
  {
    displayName: "Supreme Helper Minion!",
    name: "2",
    hidden: false,
    icon: "https://cdn.akamai.steamstatic.com/steamcommunity/public/images/apps/105600/0a6ff6a36670c96ceb4d30cf6fd69d2fdf55f38e.jpg",
    icongray:
      "https://cdn.akamai.steamstatic.com/steamcommunity/public/images/apps/105600/0a6ff6a36670c96ceb4d30cf6fd69d2fdf55f38e.jpg",
    unlocked: false,
    unlockTime: null,
  },
  {
    displayName: "Feast of Midas",
    name: "3",
    hidden: false,
    icon: "https://cdn.akamai.steamstatic.com/steamcommunity/public/images/apps/105600/2d10311274fe7c92ab25cc29afdca86b019ad472.jpg",
    icongray:
      "https://cdn.akamai.steamstatic.com/steamcommunity/public/images/apps/105600/2d10311274fe7c92ab25cc29afdca86b019ad472.jpg",
    unlocked: false,
    unlockTime: null,
  },
];

export function Sidebar() {
  const [howLongToBeat, setHowLongToBeat] = useState<{
    isLoading: boolean;
    data: HowLongToBeatCategory[] | null;
  }>({ isLoading: true, data: null });

  const { userDetails, hasActiveSubscription } = useUserDetails();
  const [activeRequirement, setActiveRequirement] =
    useState<keyof SteamAppDetails["pc_requirements"]>("minimum");

  const { gameTitle, shopDetails, objectId, shop, stats, achievements } =
    useContext(gameDetailsContext);

  const { showHydraCloudModal } = useSubscription();
  const { t } = useTranslation("game_details");
  const { formatDateTime } = useDate();
  const { numberFormatter } = useFormat();

  useEffect(() => {
    if (objectId) {
      setHowLongToBeat({ isLoading: true, data: null });

      // Directly fetch from API without checking cache
      window.electron.hydraApi
        .get<HowLongToBeatCategory[] | null>(
          `/games/${shop}/${objectId}/how-long-to-beat`,
          {
            needsAuth: false,
          }
        )
        .then((howLongToBeatData) => {
          setHowLongToBeat({ isLoading: false, data: howLongToBeatData });
        })
        .catch(() => {
          setHowLongToBeat({ isLoading: false, data: null });
        });
    }
  }, [objectId, shop]);

  return (
    <aside className="content-sidebar">
      {userDetails === null && (
        <SidebarSection title={t("achievements")}>
          <div className="achievements-placeholder">
            <LockIcon size={36} />
            <h3>{t("sign_in_to_see_achievements")}</h3>
          </div>
          <ul className="list achievements-placeholder__blur">
            {achievementsPlaceholder.map((achievement) => (
              <li key={achievement.name}>
                <div className="list__item">
                  <img
                    className={`list__item-image achievements-placeholder__blur ${
                      achievement.unlocked ? "" : "list__item-image--locked"
                    }`}
                    src={achievement.icon}
                    alt={achievement.displayName}
                    loading="lazy"
                  />
                  <div>
                    <p>{achievement.displayName}</p>
                    <small>
                      {achievement.unlockTime != null &&
                        formatDateTime(achievement.unlockTime)}
                    </small>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </SidebarSection>
      )}

      {userDetails && achievements && achievements.length > 0 && (
        <SidebarSection
          title={t("achievements_count", {
            unlockedCount: achievements.filter((a) => a.unlocked).length,
            achievementsCount: achievements.length,
          })}
        >
          <ul className="list">
            {!hasActiveSubscription && (
              <button
                className="subscription-required-button"
                onClick={() => showHydraCloudModal("achievements")}
              >
                <CloudOfflineIcon size={16} />
                <span>{t("achievements_not_sync")}</span>
              </button>
            )}

            {achievements.slice(0, 4).map((achievement) => (
              <li key={achievement.displayName}>
                <Link
                  to={buildGameAchievementPath({
                    shop: shop,
                    objectId: objectId!,
                    title: gameTitle,
                  })}
                  className="list__item"
                  title={achievement.description}
                >
                  <img
                    className={`list__item-image ${
                      achievement.unlocked ? "" : "list__item-image--locked"
                    }`}
                    src={achievement.icon}
                    alt={achievement.displayName}
                    loading="lazy"
                  />
                  <div>
                    <p>{achievement.displayName}</p>
                    <small>
                      {achievement.unlockTime != null &&
                        formatDateTime(achievement.unlockTime)}
                    </small>
                  </div>
                </Link>
              </li>
            ))}

            <Link
              to={buildGameAchievementPath({
                shop: shop,
                objectId: objectId!,
                title: gameTitle,
              })}
            >
              {t("see_all_achievements")}
            </Link>
          </ul>
        </SidebarSection>
      )}

      {stats && (
        <SidebarSection title={t("stats")}>
          <div className="stats__section">
            <div className="stats__category">
              <p className="stats__category-title">
                <DownloadIcon size={18} />
                {t("download_count")}
              </p>
              <p>{numberFormatter.format(stats?.downloadCount)}</p>
            </div>

            <div className="stats__category">
              <p className="stats__category-title">
                <PeopleIcon size={18} />
                {t("player_count")}
              </p>
              <p>{numberFormatter.format(stats?.playerCount)}</p>
            </div>

            <div className="stats__category">
              <p className="stats__category-title">
                <StarIcon size={18} />
                {t("rating_count")}
              </p>
              <StarRating
                rating={
                  stats?.averageScore === 0
                    ? null
                    : (stats?.averageScore ?? null)
                }
                size={16}
              />
            </div>
          </div>
        </SidebarSection>
      )}

      <HowLongToBeatSection
        howLongToBeatData={howLongToBeat.data}
        isLoading={howLongToBeat.isLoading}
      />

      <SidebarSection title={t("requirements")}>
        <div className="requirement__button-container">
          <Button
            className="requirement__button"
            onClick={() => setActiveRequirement("minimum")}
            theme={activeRequirement === "minimum" ? "primary" : "outline"}
          >
            {t("minimum")}
          </Button>

          <Button
            className="requirement__button"
            onClick={() => setActiveRequirement("recommended")}
            theme={activeRequirement === "recommended" ? "primary" : "outline"}
          >
            {t("recommended")}
          </Button>
        </div>

        <div
          className="requirement__details"
          dangerouslySetInnerHTML={{
            __html:
              shopDetails?.pc_requirements?.[activeRequirement] ??
              t(`no_${activeRequirement}_requirements`, {
                gameTitle,
              }),
          }}
        />
      </SidebarSection>

      <GameLanguageSection />
    </aside>
  );
}
