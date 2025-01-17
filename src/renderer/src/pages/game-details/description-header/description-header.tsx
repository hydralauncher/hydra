import { useTranslation } from "react-i18next";

import { useContext } from "react";
import { gameDetailsContext } from "@renderer/context";

export function DescriptionHeader() {
  const { shopDetails } = useContext(gameDetailsContext);

  const { t } = useTranslation("game_details");

  if (!shopDetails) return null;

  return (
    <div className="description-header">
      <section className="description-header__info">
        <p>
          {t("release_date", {
            date: shopDetails?.release_date.date,
          })}
        </p>

        {Array.isArray(shopDetails.publishers) && (
          <p>{t("publisher", { publisher: shopDetails.publishers[0] })}</p>
        )}
      </section>
    </div>
  );
}
