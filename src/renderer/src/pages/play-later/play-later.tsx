import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { BookmarkFillIcon, BookmarkIcon } from "@primer/octicons-react";
import type { PlayLaterSort } from "@types";
import { sortPlayLater } from "@shared";
import { Button, GameCard } from "@renderer/components";
import { buildGameDetailsPath } from "@renderer/helpers";
import { useDate, usePlayLater } from "@renderer/hooks";

import "./play-later.scss";

const SORT_STORAGE_KEY = "play-later-sort";

const SORT_LABELS: Record<PlayLaterSort, string> = {
  addedAt: "sort_by_date_added",
  title: "sort_by_name",
};

const readSort = (): PlayLaterSort => {
  try {
    return localStorage.getItem(SORT_STORAGE_KEY) === "title"
      ? "title"
      : "addedAt";
  } catch {
    return "addedAt";
  }
};

export default function PlayLater() {
  const { t } = useTranslation("play_later");
  const navigate = useNavigate();
  const { formatDate } = useDate();
  const { items, removeFromPlayLater } = usePlayLater();
  const [sort, setSort] = useState<PlayLaterSort>(readSort);

  const sortedItems = useMemo(() => sortPlayLater(items, sort), [items, sort]);

  const handleSortChange = (next: PlayLaterSort) => {
    setSort(next);
    try {
      localStorage.setItem(SORT_STORAGE_KEY, next);
    } catch {
      // The choice is simply not remembered.
    }
  };

  return (
    <section className="play-later">
      <header className="play-later__header">
        <h2>{t("title")}</h2>

        {sortedItems.length > 0 && (
          <ul className="play-later__sort">
            {(Object.keys(SORT_LABELS) as PlayLaterSort[]).map((option) => (
              <li key={option}>
                <Button
                  theme={option === sort ? "primary" : "outline"}
                  onClick={() => handleSortChange(option)}
                >
                  {t(SORT_LABELS[option])}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </header>

      {sortedItems.length === 0 ? (
        <div className="play-later__empty">
          <BookmarkIcon size={24} />
          <h3>{t("empty_title")}</h3>
          <p>{t("empty_description")}</p>
        </div>
      ) : (
        <ul className="play-later__cards">
          {sortedItems.map((entry) => (
            <li
              key={`${entry.shop}:${entry.objectId}`}
              className="play-later__item"
            >
              <GameCard
                game={entry}
                onClick={() => navigate(buildGameDetailsPath(entry))}
              />

              <div className="play-later__item-footer">
                <span>
                  {t("added_on", { date: formatDate(entry.addedAt) })}
                </span>

                <button
                  type="button"
                  className="play-later__remove-button"
                  onClick={() =>
                    removeFromPlayLater(entry.shop, entry.objectId)
                  }
                  title={t("remove")}
                  aria-label={t("remove")}
                >
                  <BookmarkFillIcon size={16} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
