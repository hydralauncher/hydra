import { useTranslation } from "react-i18next";
import { useContext } from "react";
import { format } from "date-fns";
import { getDateLocale } from "@shared";
import { gameDetailsContext } from "@renderer/context";
import "./description-header.scss";

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}(?:T.*)?$/;

export function DescriptionHeader() {
  const { shopDetails } = useContext(gameDetailsContext);
  const { t, i18n } = useTranslation("game_details");

  if (!shopDetails) return null;

  const rawDate = shopDetails?.release_date.date ?? "";
  const publisher =
    shopDetails.publishers?.[0] ?? shopDetails.developers?.[0] ?? "";
  let displayDate = rawDate;
  if (ISO_DATE_REGEX.test(rawDate)) {
    const parsed = new Date(
      rawDate.length === 10 ? `${rawDate}T00:00:00` : rawDate
    );
    if (!isNaN(parsed.getTime())) {
      displayDate = format(parsed, "MMM d, yyyy", {
        locale: getDateLocale(i18n.language),
      });
    }
  }

  return (
    <div className="description-header">
      <section className="description-header__info">
        <p>
          {t("release_date", {
            date: displayDate,
          })}
        </p>

        {publisher && <p>{t("publisher", { publisher })}</p>}
      </section>
    </div>
  );
}
