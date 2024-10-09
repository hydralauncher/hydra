import { useContext, useEffect, useState } from "react";
import type { HowLongToBeatCategory, SteamAppDetails } from "@types";
import { useTranslation } from "react-i18next";
import { Button, Link } from "@renderer/components";

import * as styles from "./sidebar.css";
import { gameDetailsContext } from "@renderer/context";
import { useDate, useFormat } from "@renderer/hooks";
import { DownloadIcon, PeopleIcon } from "@primer/octicons-react";
import { HowLongToBeatSection } from "./how-long-to-beat-section";
import { howLongToBeatEntriesTable } from "@renderer/dexie";
import { SidebarSection } from "../sidebar-section/sidebar-section";
import { buildGameAchievementPath } from "@renderer/helpers";

export function Sidebar() {
  const [howLongToBeat, setHowLongToBeat] = useState<{
    isLoading: boolean;
    data: HowLongToBeatCategory[] | null;
  }>({ isLoading: true, data: null });

  const [activeRequirement, setActiveRequirement] =
    useState<keyof SteamAppDetails["pc_requirements"]>("minimum");

  const { gameTitle, shopDetails, objectId, shop, stats, achievements } =
    useContext(gameDetailsContext);

  const { t } = useTranslation("game_details");
  const { format } = useDate();

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
      {achievements.length > 0 && (
        <SidebarSection
          title={t("achievements", {
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
                    src={
                      achievement.unlocked
                        ? achievement.icon
                        : achievement.icongray
                    }
                    alt={achievement.displayName}
                    loading="lazy"
                  />
                  <div>
                    <p>{achievement.displayName}</p>
                    <small>
                      {achievement.unlockTime && format(achievement.unlockTime)}
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
