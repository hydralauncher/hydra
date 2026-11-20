import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  AppsIcon,
  BookmarkFillIcon,
  BookmarkIcon,
  RowsIcon,
  SquareIcon,
} from "@primer/octicons-react";
import type { PlayLaterSort, PlayLaterViewMode } from "@types";
import {
  parsePlayLaterSort,
  parsePlayLaterViewMode,
  sortPlayLater,
} from "@shared";
import { Button } from "@renderer/components";
import { buildGameDetailsPath } from "@renderer/helpers";
import { useDate, usePlayLater } from "@renderer/hooks";
import { PlayLaterCard } from "./play-later-card";

import "./play-later.scss";

const SORT_STORAGE_KEY = "play-later-sort";
const VIEW_MODE_STORAGE_KEY = "play-later-view-mode";

const SORT_LABELS: Record<PlayLaterSort, string> = {
  addedAt: "sort_by_date_added",
  title: "sort_by_name",
};

// Same icons and labels as the library's view menu.
const VIEW_OPTIONS: {
  value: PlayLaterViewMode;
  label: string;
  icon: JSX.Element;
}[] = [
  { value: "compact", label: "view_compact", icon: <SquareIcon size={16} /> },
  { value: "grid", label: "view_grid", icon: <AppsIcon size={16} /> },
  { value: "large", label: "view_large", icon: <RowsIcon size={16} /> },
];

const readStored = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const writeStored = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // The choice is simply not remembered.
  }
};

export default function PlayLater() {
  const { t } = useTranslation(["play_later", "library"]);
  const navigate = useNavigate();
  const { formatDate } = useDate();
  const { items, removeFromPlayLater } = usePlayLater();
  const [sort, setSort] = useState<PlayLaterSort>(() =>
    parsePlayLaterSort(readStored(SORT_STORAGE_KEY))
  );
  const [viewMode, setViewMode] = useState<PlayLaterViewMode>(() =>
    parsePlayLaterViewMode(readStored(VIEW_MODE_STORAGE_KEY))
  );

  const sortedItems = useMemo(() => sortPlayLater(items, sort), [items, sort]);

  const handleSortChange = (next: PlayLaterSort) => {
    setSort(next);
    writeStored(SORT_STORAGE_KEY, next);
  };

  const handleViewModeChange = (next: PlayLaterViewMode) => {
    setViewMode(next);
    writeStored(VIEW_MODE_STORAGE_KEY, next);
  };

  return (
    <section className="play-later">
      <header className="play-later__header">
        <h2>{t("title")}</h2>

        {sortedItems.length > 0 && (
          <div className="play-later__toolbar">
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

            <div
              className="play-later__views"
              role="group"
              aria-label={t("view_mode", { ns: "library" })}
            >
              {VIEW_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`play-later__view${option.value === viewMode ? " play-later__view--active" : ""}`}
                  onClick={() => handleViewModeChange(option.value)}
                  aria-pressed={option.value === viewMode}
                  title={t(option.label, { ns: "library" })}
                  aria-label={t(option.label, { ns: "library" })}
                >
                  {option.icon}
                </button>
              ))}
            </div>
          </div>
        )}
      </header>

      {sortedItems.length === 0 ? (
        <div className="play-later__empty">
          <BookmarkIcon size={24} />
          <h3>{t("empty_title")}</h3>
          <p>{t("empty_description")}</p>
        </div>
      ) : (
        <ul className={`play-later__cards play-later__cards--${viewMode}`}>
          {sortedItems.map((entry) => (
            <li
              key={`${entry.shop}:${entry.objectId}`}
              className="play-later__item"
            >
              <PlayLaterCard
                entry={entry}
                viewMode={viewMode}
                onClick={() => navigate(buildGameDetailsPath(entry))}
              />

              <div className="play-later__item-footer">
                <span
                  className="play-later__added-on"
                  title={t("added_on", { date: formatDate(entry.addedAt) })}
                >
                  {/* Compact cards are too narrow for the full label. */}
                  {viewMode === "compact"
                    ? formatDate(entry.addedAt)
                    : t("added_on", { date: formatDate(entry.addedAt) })}
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
