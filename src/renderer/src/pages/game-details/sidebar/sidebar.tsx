import { useContext, useState } from "react";
import type { HowLongToBeatCategory, SteamAppDetails } from "@types";
import { useTranslation } from "react-i18next";
import { Button } from "@renderer/components";

import * as styles from "./sidebar.css";
import { gameDetailsContext } from "@renderer/context";
import { useDate, useFormat } from "@renderer/hooks";
import { DownloadIcon, PeopleIcon } from "@primer/octicons-react";
import { SPACING_UNIT } from "@renderer/theme.css";

export function Sidebar() {
  const [_howLongToBeat, _setHowLongToBeat] = useState<{
    isLoading: boolean;
    data: HowLongToBeatCategory[] | null;
  }>({ isLoading: true, data: null });

  const [activeRequirement, setActiveRequirement] =
    useState<keyof SteamAppDetails["pc_requirements"]>("minimum");

  const { gameTitle, shopDetails, stats, achievements } =
    useContext(gameDetailsContext);

  const { t } = useTranslation("game_details");
  const { format } = useDate();

  const { numberFormatter } = useFormat();

  // useEffect(() => {
  //   if (objectId) {
  //     setHowLongToBeat({ isLoading: true, data: null });

  //     window.electron
  //       .getHowLongToBeat(objectId, "steam", gameTitle)
  //       .then((howLongToBeat) => {
  //         setHowLongToBeat({ isLoading: false, data: howLongToBeat });
  //       })
  //       .catch(() => {
  //         setHowLongToBeat({ isLoading: false, data: null });
  //       });
  //   }
  // }, [objectId, gameTitle]);

  return (
    <aside className={styles.contentSidebar}>
      {/* <HowLongToBeatSection
        howLongToBeatData={howLongToBeat.data}
        isLoading={howLongToBeat.isLoading}
      /> */}

      {achievements.length > 0 && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: `${SPACING_UNIT}px`,
            padding: `${SPACING_UNIT}px`,
          }}
        >
          {achievements.map((achievement, index) => (
            <div
              key={index}
              style={{
                display: "flex",
                flexDirection: "row",
                alignItems: "center",
                gap: `${SPACING_UNIT}px`,
              }}
              title={achievement.description}
            >
              <img
                style={{
                  height: "72px",
                  width: "72px",
                  filter: achievement.unlocked ? "none" : "grayscale(100%)",
                }}
                src={
                  achievement.unlocked ? achievement.icon : achievement.icongray
                }
                alt={achievement.displayName}
                loading="lazy"
              />
              <div>
                <p>{achievement.displayName}</p>
                {achievement.unlockTime && format(achievement.unlockTime)}
              </div>
            </div>
          ))}
        </div>
      )}

      {stats && (
        <>
          <div
            className={styles.contentSidebarTitle}
            style={{ border: "none" }}
          >
            <h3>{t("stats")}</h3>
          </div>

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
        </>
      )}

      <div className={styles.contentSidebarTitle} style={{ border: "none" }}>
        <h3>{t("requirements")}</h3>
      </div>
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
    </aside>
  );
}
