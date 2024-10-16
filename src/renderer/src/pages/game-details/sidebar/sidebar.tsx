import { useContext, useEffect, useState } from "react";
import type {
  HowLongToBeatCategory,
  SteamAppDetails,
  UserAchievement,
} from "@types";
import { useTranslation } from "react-i18next";
import { Button, Link } from "@renderer/components";

import * as styles from "./sidebar.css";
import { gameDetailsContext } from "@renderer/context";
import { useDate, useFormat, useUserDetails } from "@renderer/hooks";
import { DownloadIcon, LockIcon, PeopleIcon } from "@primer/octicons-react";
import { HowLongToBeatSection } from "./how-long-to-beat-section";
import { howLongToBeatEntriesTable } from "@renderer/dexie";
import { SidebarSection } from "../sidebar-section/sidebar-section";
import { buildGameAchievementPath } from "@renderer/helpers";
import { SPACING_UNIT } from "@renderer/theme.css";

const fakeAchievements: UserAchievement[] = [
  {
    displayName: "Timber!!",
    name: "",
    hidden: false,
    description: "Chop down your first tree.",
    icon: "https://cdn.akamai.steamstatic.com/steamcommunity/public/images/apps/105600/0fbb33098c9da39d1d4771d8209afface9c46e81.jpg",
    unlocked: true,
    unlockTime: Date.now(),
  },
  {
    displayName: "Supreme Helper Minion!",
    name: "",
    hidden: false,
    icon: "https://cdn.akamai.steamstatic.com/steamcommunity/public/images/apps/105600/0a6ff6a36670c96ceb4d30cf6fd69d2fdf55f38e.jpg",
    unlocked: false,
    unlockTime: null,
  },
  {
    displayName: "Feast of Midas",
    name: "",
    hidden: false,
    icon: "https://cdn.akamai.steamstatic.com/steamcommunity/public/images/apps/105600/2d10311274fe7c92ab25cc29afdca86b019ad472.jpg",
    unlocked: false,
    unlockTime: null,
  },
];

export function Sidebar() {
  const [howLongToBeat, setHowLongToBeat] = useState<{
    isLoading: boolean;
    data: HowLongToBeatCategory[] | null;
  }>({ isLoading: true, data: null });

  const { userDetails } = useUserDetails();

  const [activeRequirement, setActiveRequirement] =
    useState<keyof SteamAppDetails["pc_requirements"]>("minimum");

  const { gameTitle, shopDetails, objectId, shop, stats, achievements } =
    useContext(gameDetailsContext);

  const { t } = useTranslation("game_details");
  const { formatDateTime } = useDate();

  const { numberFormatter } = useFormat();

  useEffect(() => {
    if (objectId) {
      setHowLongToBeat({ isLoading: true, data: null });

      howLongToBeatEntriesTable
        .where({ shop, objectId })
        .first()
        .then(async (cachedHowLongToBeat) => {
          if (cachedHowLongToBeat) {
            setHowLongToBeat({
              isLoading: false,
              data: cachedHowLongToBeat.categories,
            });
          } else {
            try {
              const howLongToBeat =
                await window.electron.getHowLongToBeat(gameTitle);

              if (howLongToBeat) {
                howLongToBeatEntriesTable.add({
                  objectId,
                  shop: "steam",
                  createdAt: new Date(),
                  updatedAt: new Date(),
                  categories: howLongToBeat,
                });
              }

              setHowLongToBeat({ isLoading: false, data: howLongToBeat });
            } catch (err) {
              setHowLongToBeat({ isLoading: false, data: null });
            }
          }
        });
    }
  }, [objectId, shop, gameTitle]);

  return (
    <aside className={styles.contentSidebar}>
      {userDetails === null && (
        <SidebarSection title={t("achievements")}>
          <div
            style={{
              position: "absolute",
              zIndex: 2,
              inset: 0,
              width: "100%",
              height: "100%",
              background: "rgba(0, 0, 0, 0.7)",
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              flexDirection: "column",
              gap: `${SPACING_UNIT}px`,
            }}
          >
            <LockIcon size={36} />
            <h3>{t("sign_in_to_see_achievements")}</h3>
          </div>
          <ul className={styles.list} style={{ filter: "blur(4px)" }}>
            {fakeAchievements.map((achievement, index) => (
              <li key={index}>
                <div className={styles.listItem}>
                  <img
                    style={{ filter: "blur(8px)" }}
                    className={styles.listItemImage({
                      unlocked: achievement.unlocked,
                    })}
                    src={achievement.icon}
                    alt={achievement.displayName}
                  />
                  <div>
                    <p>{achievement.displayName}</p>
                    <small>
                      {achievement.unlockTime &&
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
          <ul className={styles.list}>
            {achievements.slice(0, 4).map((achievement, index) => (
              <li key={index}>
                <Link
                  to={buildGameAchievementPath({
                    shop: shop,
                    objectId: objectId!,
                    title: gameTitle,
                  })}
                  className={styles.listItem}
                  title={achievement.description}
                >
                  <img
                    className={styles.listItemImage({
                      unlocked: achievement.unlocked,
                    })}
                    src={achievement.icon}
                    alt={achievement.displayName}
                  />
                  <div>
                    <p>{achievement.displayName}</p>
                    <small>
                      {achievement.unlockTime &&
                        formatDateTime(achievement.unlockTime)}
                    </small>
                  </div>
                </Link>
              </li>
            ))}

            <Link
              style={{ textAlign: "center" }}
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
          <div className={styles.statsSection}>
            <div className={styles.statsCategory}>
              <p className={styles.statsCategoryTitle}>
                <DownloadIcon size={18} />
                {t("download_count")}
              </p>
              <p>{numberFormatter.format(stats?.downloadCount)}</p>
            </div>

            <div className={styles.statsCategory}>
              <p className={styles.statsCategoryTitle}>
                <PeopleIcon size={18} />
                {t("player_count")}
              </p>
              <p>{numberFormatter.format(stats?.playerCount)}</p>
            </div>
          </div>
        </SidebarSection>
      )}

      <HowLongToBeatSection
        howLongToBeatData={howLongToBeat.data}
        isLoading={howLongToBeat.isLoading}
      />

      <SidebarSection title={t("requirements")}>
        <div className={styles.requirementButtonContainer}>
          <Button
            className={styles.requirementButton}
            onClick={() => setActiveRequirement("minimum")}
            theme={activeRequirement === "minimum" ? "primary" : "outline"}
          >
            {t("minimum")}
          </Button>

          <Button
            className={styles.requirementButton}
            onClick={() => setActiveRequirement("recommended")}
            theme={activeRequirement === "recommended" ? "primary" : "outline"}
          >
            {t("recommended")}
          </Button>
        </div>

        <div
          className={styles.requirementsDetails}
          dangerouslySetInnerHTML={{
            __html:
              shopDetails?.pc_requirements?.[activeRequirement] ??
              t(`no_${activeRequirement}_requirements`, {
                gameTitle,
              }),
          }}
        />
      </SidebarSection>
    </aside>
  );
}
