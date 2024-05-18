import { SizeProp } from "@fortawesome/fontawesome-svg-core";
import { faStar as EstrelaVazia } from "@fortawesome/free-regular-svg-icons";
import {
  faStar as EstrelaPreenchida,
  faStarHalfStroke as EstrelaParcialmentePreenchida,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { UserPreferences, type SteamUserRating } from "@types";
import { FC, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import * as styles from "./sidebar.css";

interface StarProps {
  selected: boolean;
  size?: SizeProp;
  partial?: boolean;
}

const Star: FC<StarProps> = ({ selected, size, partial = false }) => {
  let finalIcon = <FontAwesomeIcon icon={EstrelaVazia} size={size ?? "xl"} />;
  if (selected) {
    finalIcon = (
      <FontAwesomeIcon icon={EstrelaPreenchida} size={size ?? "xl"} />
    );
  }
  if (partial) {
    finalIcon = (
      <FontAwesomeIcon
        icon={EstrelaParcialmentePreenchida}
        size={size ?? "xl"}
      />
    );
  }
  return finalIcon;
};

export interface RatingProps {
  maxStars?: number;
  value?: number;
  size?: SizeProp;
  title?: string;
  hideInactive?: boolean;
}

const Rating: FC<RatingProps> = ({
  maxStars = 5,
  value = 0,
  size = "2xl",
  title,
  hideInactive = false,
}) => {
  return (
    <div className={styles.userRatingStars} title={title ?? ""}>
      {Array(hideInactive ? value / 2 : maxStars)
        .fill(null)
        .map((_, i) => (
          <Star
            key={`${_}-${i}`}
            selected={i < Math.floor(value / 2)}
            partial={i === Math.floor(value / 2) && !!(value % 2)}
            size={size}
          />
        ))}
    </div>
  );
};

export default function SteamUserRatingSection({
  steamUserRating,
}: Readonly<{ steamUserRating: SteamUserRating | null }>) {
  const { t } = useTranslation("game_details");
  const [userPreferences, setUserPreferences] =
    useState<UserPreferences | null>(null);

  useEffect(() => {
    window.electron.getUserPreferences().then((userPreferences) => {
      setUserPreferences(userPreferences);
    });
  }, []);

  if (userPreferences?.userRatingStyle === "bar") {
    return (
      <>
        <div className={styles.contentSidebarTitle}>
          <h3>{t("reviews_steam")}</h3>
        </div>
        <div
          className={`steamuserrating ${styles.steamUserRatingBarContainer}`}
        >
          <div
            className={styles.bar}
            title={`${steamUserRating?.review_score.toFixed(1) ?? 0.0} - ${steamUserRating?.review_score_desc ?? ""} (${steamUserRating?.total_positive ?? 0})`}
          >
            <div
              className={styles.barfilling}
              style={{ width: `${(steamUserRating?.review_score ?? 0) * 10}%` }}
            />
          </div>
          <div className={styles.rating}>
            <span>{t("total_reviews")}:</span>
            <span>
              {steamUserRating?.review_score_desc ?? ""} (
              {steamUserRating?.total_reviews ?? 0})
            </span>
          </div>
        </div>
      </>
    );
  }

  if (userPreferences?.userRatingStyle === "star") {
    return (
      <>
        <div className={styles.contentSidebarTitle}>
          <h3>{t("reviews_steam")}</h3>
        </div>

        <div className={`steamuserrating ${styles.steamUserRatingContainer}`}>
          <Rating
            value={steamUserRating?.review_score ?? 0}
            title={`${steamUserRating?.review_score.toFixed(1) ?? 0.0} - ${steamUserRating?.review_score_desc ?? ""} (${steamUserRating?.total_positive ?? 0})`}
            size="xl"
          />

          <div className={styles.rating}>
            <span>{t("total_reviews")}:</span>
            <span>
              {steamUserRating?.review_score_desc ?? ""} (
              {steamUserRating?.total_reviews ?? 0})
            </span>
          </div>
        </div>
      </>
    );
  }

  return <></>;
}
