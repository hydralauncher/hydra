import { useTranslation } from "react-i18next";
import { type SteamUserRating } from "@types";

import * as styles from "./sidebar.css";
import "./sidebar.rating.css";

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
        <div className={styles.userRatingStars}>
          <input
            readOnly
            type="radio"
            id="rs0"
            checked={(steamUserRating?.review_score ?? 0) < 1}
          />
          <label htmlFor="rs0">
            <span>0</span>
          </label>

          <input
            readOnly
            type="radio"
            id="rs1"
            checked={
              (steamUserRating?.review_score ?? 0) >= 1 &&
              (steamUserRating?.review_score ?? 0) <= 2
            }
          />
          <label htmlFor="rs1">
            <span>1</span>
          </label>

          <input
            readOnly
            type="radio"
            id="rs2"
            checked={
              (steamUserRating?.review_score ?? 0) > 2 &&
              (steamUserRating?.review_score ?? 0) <= 4
            }
          />
          <label htmlFor="rs2">
            <span>2</span>
          </label>

          <input
            readOnly
            type="radio"
            id="rs3"
            checked={
              (steamUserRating?.review_score ?? 0) > 4 &&
              (steamUserRating?.review_score ?? 0) <= 6
            }
          />
          <label htmlFor="rs3">
            <span>3</span>
          </label>

          <input
            readOnly
            type="radio"
            id="rs4"
            checked={
              (steamUserRating?.review_score ?? 0) > 6 &&
              (steamUserRating?.review_score ?? 0) <= 8
            }
          />
          <label htmlFor="rs4">
            <span>4</span>
          </label>

          <input
            readOnly
            type="radio"
            id="rs5"
            checked={
              (steamUserRating?.review_score ?? 0) > 8 &&
              (steamUserRating?.review_score ?? 0) <= 10
            }
          />
          <label htmlFor="rs5">
            <span>5</span>
          </label>
        </div>

        <span className="rating">
          {`${t("total_reviews")}: ${steamUserRating?.total_reviews ?? 0}`}
        </span>
      </div>
    </>
  );
}
