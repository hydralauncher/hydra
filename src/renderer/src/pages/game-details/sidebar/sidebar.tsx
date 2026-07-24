import { lazy, Suspense, useContext, useEffect, useState } from "react";
import type {
  HowLongToBeatCategory,
  ProtonDBData,
  SteamAppDetails,
  UserAchievement,
} from "@types";
import { useTranslation } from "react-i18next";
import { Button } from "@renderer/components/button/button";
import { Link } from "@renderer/components/link/link";
import { StarRating } from "@renderer/components/star-rating/star-rating";

import { gameDetailsContext } from "@renderer/context";
import {
  useAppSelector,
  useDate,
  useFormat,
  useUserDetails,
} from "@renderer/hooks";
import {
  AlertIcon,
  DownloadIcon,
  LockIcon,
  PeopleIcon,
  StarIcon,
} from "@primer/octicons-react";
import { HowLongToBeatSection } from "./how-long-to-beat-section";
import { LaunchboxDetailsSection } from "./launchbox-details-section";
import { SidebarSection } from "../sidebar-section/sidebar-section";
import { buildGameAchievementPath } from "@renderer/helpers";
import { useSubscription } from "@renderer/hooks/use-subscription";
import { RetroAchievementsConnectBanner } from "@renderer/components/retro-achievements-connect-banner/retro-achievements-connect-banner";
import "./sidebar.scss";
import { GameLanguageSection } from "./game-language-section";
import { ControllerSupportSection } from "./controller-support-section";

const ProtonDBSection = lazy(async () => {
  const mod = await import("./protondb-section");
  return { default: mod.ProtonDBSection };
});

const protonDBResponseCache = new Map<string, ProtonDBData | null>();
const protonDBInFlightRequests = new Map<
  string,
  Promise<ProtonDBData | null>
>();

const getProtonDBData = (shop: string, objectId: string) => {
  const cacheKey = `${shop}:${objectId}`;

  if (protonDBResponseCache.has(cacheKey)) {
    return Promise.resolve(protonDBResponseCache.get(cacheKey) ?? null);
  }

  const inFlightRequest = protonDBInFlightRequests.get(cacheKey);
  if (inFlightRequest) {
    return inFlightRequest;
  }

  const request = window.electron.hydraApi
    .get<ProtonDBData | null>(`/games/${shop}/${objectId}/protondb`, {
      needsAuth: false,
    })
    .then((protonData) => {
      protonDBResponseCache.set(cacheKey, protonData);
      return protonData;
    })
    .catch(() => null)
    .finally(() => {
      protonDBInFlightRequests.delete(cacheKey);
    });

  protonDBInFlightRequests.set(cacheKey, request);
  return request;
};

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

const POPULAR_CATEGORY_IDS = new Set<number>([
  1, 2, 9, 18, 24, 28, 36, 37, 38, 39, 47, 48, 49,
]);

export function Sidebar() {
  const shouldShowProtonFeatures = window.electron.platform === "linux";
  const [howLongToBeat, setHowLongToBeat] = useState<{
    isLoading: boolean;
    data: HowLongToBeatCategory[] | null;
  }>({ isLoading: true, data: null });
  const [protonDB, setProtonDB] = useState<{
    isLoading: boolean;
    data: ProtonDBData | null;
  }>({ isLoading: shouldShowProtonFeatures, data: null });

  const { userDetails, hasActiveSubscription } = useUserDetails();
  const [activeRequirement, setActiveRequirement] =
    useState<keyof SteamAppDetails["pc_requirements"]>("minimum");

  const { gameTitle, shopDetails, objectId, shop, stats, achievements } =
    useContext(gameDetailsContext);
  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const { showHydraCloudModal } = useSubscription();
  const { t } = useTranslation("game_details");
  const { formatDateTime } = useDate();
  const { numberFormatter } = useFormat();
  const achievementsCount = achievements?.length ?? 0;
  const shouldRenderAchievementsSection =
    (!!userDetails && achievementsCount > 0) ||
    (shop === "launchbox" &&
      !!shopDetails?.retroAchievementsGameId &&
      !userPreferences?.retroAchievementsWebApiKey);

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

  useEffect(() => {
    if (!shouldShowProtonFeatures || !objectId) {
      setProtonDB({ isLoading: false, data: null });
      return;
    }

    setProtonDB({ isLoading: true, data: null });

    getProtonDBData(shop, objectId)
      .then((protonData) => {
        setProtonDB({ isLoading: false, data: protonData });
      })
      .catch(() => {
        setProtonDB({ isLoading: false, data: null });
      });
  }, [shouldShowProtonFeatures, objectId, shop]);

  return (
    <aside className="content-sidebar">
      {shouldShowProtonFeatures && (
        <Suspense fallback={null}>
          <ProtonDBSection
            protonDBData={protonDB.data}
            isLoading={protonDB.isLoading}
            objectId={objectId ?? ""}
          />
        </Suspense>
      )}

      {userDetails === null && !shouldRenderAchievementsSection && (
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

      {shouldRenderAchievementsSection && (
        <SidebarSection
          title={
            achievementsCount > 0
              ? t("achievements_count", {
                  unlockedCount:
                    achievements?.filter((a) => a.unlocked).length ?? 0,
                  achievementsCount,
                })
              : t("achievements")
          }
        >
          <ul className="list">
            <RetroAchievementsConnectBanner />

            {!hasActiveSubscription && achievementsCount > 0 && (
              <button
                type="button"
                className="subscription-required-button"
                onClick={() => showHydraCloudModal("achievements")}
              >
                <AlertIcon size={14} />
                <span>{t("achievements_not_sync")}</span>
              </button>
            )}

            {(achievements ?? []).slice(0, 4).map((achievement) => (
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

            {achievementsCount > 0 && (
              <Link
                to={buildGameAchievementPath({
                  shop: shop,
                  objectId: objectId!,
                  title: gameTitle,
                })}
              >
                {t("see_all_achievements")}
              </Link>
            )}
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

      {shop === "launchbox" && (
        <LaunchboxDetailsSection
          platform={shopDetails?.platform}
          genres={shopDetails?.genres?.map((g) => g.name)}
          skus={shopDetails?.skus}
        />
      )}

      {shop !== "launchbox" && shopDetails && (
        <SidebarSection
          title={t("genres_and_features", {
            defaultValue: "Genres & Spécificités",
          })}
        >
          <div className="game-details-sidebar__chips-container">
            {shopDetails.genres && shopDetails.genres.length > 0 && (
              <div className="game-details-sidebar__chips-group">
                <span className="game-details-sidebar__chips-label">
                  {t("genres", { defaultValue: "Genres" })}
                </span>
                <div className="game-details-sidebar__chips-list">
                  {shopDetails.genres.slice(0, 3).map((genre) => (
                    <span
                      key={genre.id}
                      className="game-details-sidebar__chip game-details-sidebar__chip--genre"
                    >
                      {genre.name ||
                        (genre as unknown as { description?: string })
                          .description ||
                        ""}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {shopDetails.categories && shopDetails.categories.length > 0 && (
              <div className="game-details-sidebar__chips-group">
                <span className="game-details-sidebar__chips-label">
                  {t("features", { defaultValue: "Spécificités" })}
                </span>
                <div className="game-details-sidebar__chips-list">
                  {shopDetails.categories
                    .filter((cat) => POPULAR_CATEGORY_IDS.has(cat.id))
                    .slice(0, 5)
                    .map((cat) => (
                      <span
                        key={cat.id}
                        className="game-details-sidebar__chip game-details-sidebar__chip--feature"
                      >
                        {cat.description}
                      </span>
                    ))}
                </div>
              </div>
            )}
          </div>
        </SidebarSection>
      )}

      <HowLongToBeatSection
        howLongToBeatData={howLongToBeat.data}
        isLoading={howLongToBeat.isLoading}
      />

      <ControllerSupportSection />

      {shop !== "launchbox" && (
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
              theme={
                activeRequirement === "recommended" ? "primary" : "outline"
              }
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
      )}

      <GameLanguageSection />
    </aside>
  );
}
