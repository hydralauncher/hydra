import { useTranslation } from "react-i18next";

import type { ShopDetails } from "@types";

import * as styles from "./game-details.css";

export interface DescriptionHeaderProps {
  gameDetails: ShopDetails;
}

export function DescriptionHeader({ gameDetails }: DescriptionHeaderProps) {
  const { t } = useTranslation("game_details");

  return (
    <div className={styles.descriptionHeader}>
      <section className={styles.descriptionHeaderInfo}>
        <p>
          {t("release_date", {
            date: gameDetails?.release_date.date,
          })}
        </p>
        <p>{t("publisher", { publisher: gameDetails.publishers[0] })}</p>
      </section>
    </div>
  );
}
