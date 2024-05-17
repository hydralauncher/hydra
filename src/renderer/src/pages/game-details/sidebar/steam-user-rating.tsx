import { SizeProp } from "@fortawesome/fontawesome-svg-core";
import { faStar as EstrelaVazia } from "@fortawesome/free-regular-svg-icons";
import { faStar as EstrelaPreenchida } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { type SteamUserRating } from "@types";
import { FC } from "react";
import { useTranslation } from "react-i18next";

import * as styles from "./sidebar.css";

interface StarProps {
  selected: boolean;
  size?: SizeProp;
}

const Star: FC<StarProps> = ({ selected, size }) => {
  return selected ? (
    <FontAwesomeIcon icon={EstrelaPreenchida} size={size ?? "xl"} />
  ) : (
    <FontAwesomeIcon icon={EstrelaVazia} size={size ?? "xl"} />
  );
};

export interface RatingProps {
  maxStars?: number;
  value?: number;
  size?: SizeProp;
  hideInactive?: boolean;
}

const Rating: FC<RatingProps> = ({
  maxStars = 5,
  value = 0,
  size = "2xl",
  hideInactive = false,
}) => {
  return (
    <div className={styles.userRatingStars}>
      {Array(hideInactive ? value : maxStars)
        .fill(null)
        .map((_, i) => i + 1)
        .map((starNumber) => (
          <Star
            key={starNumber}
            selected={starNumber <= (value + 1) / 2}
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

  return (
    <>
      <div className={styles.contentSidebarTitle}>
        <h3>{t("rating_steam")}</h3>
      </div>

      <div
        className={`steamuserrating ${styles.steamUserRatingContainer}`}
        title={`${steamUserRating?.review_score.toFixed(1) ?? 0.0} - ${steamUserRating?.review_score_desc ?? ""} (${steamUserRating?.total_positive ?? 0})`}
      >
        <Rating value={steamUserRating?.review_score ?? 0} size="xl" />

        <span className="rating">
          {`${t("total_reviews")}: ${steamUserRating?.total_reviews ?? 0}`}
        </span>
      </div>
    </>
  );
}
