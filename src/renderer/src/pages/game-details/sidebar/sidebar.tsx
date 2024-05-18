import { useEffect, useState } from "react";
import { HowLongToBeatSection } from "./how-long-to-beat-section";
import {
  type SteamUserRating,
  type HowLongToBeatCategory,
  type ShopDetails,
  type SteamAppDetails,
} from "@types";
import { useTranslation } from "react-i18next";
import { Button } from "@renderer/components";

import * as styles from "./sidebar.css";
import SteamUserRatingSection from "./steam-user-rating";
import SteamGameRecommendations from "./game-recommendations";

export interface SidebarProps {
  objectID: string;
  title: string;
  gameDetails: ShopDetails | null;
}

export function Sidebar({
  objectID,
  title,
  gameDetails,
}: Readonly<SidebarProps>) {
  const [howLongToBeat, setHowLongToBeat] = useState<{
    isLoading: boolean;
    data: HowLongToBeatCategory[] | null;
  }>({ isLoading: true, data: null });

  const [activeRequirement, setActiveRequirement] =
    useState<keyof SteamAppDetails["pc_requirements"]>("minimum");
  const [steamUserRating, setSteamUserRating] =
    useState<SteamUserRating | null>(null);

  const { t } = useTranslation("game_details");

  useEffect(() => {
    setHowLongToBeat({ isLoading: true, data: null });

    window.electron
      .getHowLongToBeat(objectID, "steam", title)
      .then((howLongToBeat) => {
        setHowLongToBeat({ isLoading: false, data: howLongToBeat });
      })
      .catch(() => {
        setHowLongToBeat({ isLoading: false, data: null });
      });

    window.electron
      .getSteamUserRating(objectID)
      .then((userRating) => {
        setSteamUserRating(userRating);
      })
      .catch(() => {
        setSteamUserRating(null);
      });
  }, [objectID, title]);

  return (
    <aside className={styles.contentSidebar}>
      {/* Rating Section */}
      <SteamUserRatingSection steamUserRating={steamUserRating} />

      <HowLongToBeatSection
        howLongToBeatData={howLongToBeat.data}
        isLoading={howLongToBeat.isLoading}
      />

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
            gameDetails?.pc_requirements?.[activeRequirement] ??
            t(`no_${activeRequirement}_requirements`, {
              title,
            }),
        }}
      />

      <SteamGameRecommendations gameID={objectID} />
    </aside>
  );
}
