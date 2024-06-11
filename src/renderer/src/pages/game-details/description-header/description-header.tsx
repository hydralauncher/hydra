import { useTranslation } from "react-i18next";

import * as styles from "./description-header.css";
import { useContext } from "react";
import { gameDetailsContext } from "@renderer/context";

export function DescriptionHeader() {
  const { shopDetails } = useContext(gameDetailsContext);

  const { t } = useTranslation("game_details");

  if (!shopDetails) return null;

  return (
    <div className={styles.descriptionHeader}>
      <section className={styles.descriptionHeaderInfo}>
        <p>
          {t("release_date", {
            date: shopDetails?.release_date.date,
          })}
        </p>
        <p>{t("publisher", { publisher: shopDetails.publishers[0] })}</p>
      </section>
    </div>
  );
}
