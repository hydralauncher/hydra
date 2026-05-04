import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { orderBy } from "lodash-es";
import type { GameRepack, LibraryGame } from "@types";
import { useDate } from "@renderer/hooks";
import { useBigPictureContext } from "./big-picture-app";
import "./bp-repacks-view.scss";

interface BpRepacksViewProps {
  repacks: GameRepack[];
  game: LibraryGame | null;
  onSelectRepack: (repack: GameRepack) => void;
}

export function BpRepacksView({
  repacks,
  game,
  onSelectRepack,
}: Readonly<BpRepacksViewProps>) {
  const { t } = useTranslation("big_picture");
  const { formatDate } = useDate();
  const {
    registerSectionHandler,
    unregisterSectionHandler,
    registerPageHandler,
    unregisterPageHandler,
    resetFocus,
    focusNth,
  } = useBigPictureContext();

  const [activeSourceIndex, setActiveSourceIndex] = useState(0);
  const [currentItemIndex, setCurrentItemIndex] = useState(-1);
  const listRef = useRef<HTMLDivElement>(null);

  const getRepackAvailabilityStatus = (
    repack: GameRepack
  ): "online" | "partial" | "offline" => {
    const unavailableSet = new Set(repack.unavailableUris ?? []);
    const availableCount = repack.uris.filter(
      (uri) => !unavailableSet.has(uri)
    ).length;
    const unavailableCount = repack.uris.length - availableCount;

    if (unavailableCount === 0) return "online";
    if (availableCount === 0) return "offline";
    return "partial";
  };

  const checkIfLastDownloadedOption = useCallback(
    (repack: GameRepack) => {
      if (!game?.download) return false;
      return repack.uris.some((uri) => uri.includes(game.download!.uri));
    },
    [game?.download]
  );

  const sortedRepacks = useMemo(() => {
    return orderBy(repacks, [(r) => r.uploadDate], ["desc"]);
  }, [repacks]);

  const sourceList = useMemo(() => {
    const groups: Record<string, GameRepack[]> = {};

    for (const repack of sortedRepacks) {
      const source = repack.downloadSourceName;
      if (!groups[source]) {
        groups[source] = [];
      }
      groups[source].push(repack);
    }

    const lastDownloadedSource = Object.entries(groups).find(([, repacks]) =>
      repacks.some((r) => checkIfLastDownloadedOption(r))
    );

    return orderBy(
      Object.entries(groups).map(([source, repacks]) => ({
        source,
        repacks,
        hasLastDownloaded: source === lastDownloadedSource?.[0],
      })),
      [(g) => g.hasLastDownloaded, (g) => g.repacks.length],
      ["desc", "desc"]
    );
  }, [sortedRepacks, checkIfLastDownloadedOption]);

  const activeRepacks = useMemo(() => {
    return sourceList[activeSourceIndex]?.repacks ?? [];
  }, [sourceList, activeSourceIndex]);

  // Register LB/RB to switch source tabs
  useEffect(() => {
    const handler = (direction: "prev" | "next"): boolean => {
      if (sourceList.length <= 1) return false;

      setActiveSourceIndex((prev) => {
        if (direction === "prev") {
          return prev > 0 ? prev - 1 : sourceList.length - 1;
        }
        return prev < sourceList.length - 1 ? prev + 1 : 0;
      });

      return true;
    };

    registerSectionHandler(handler);
    return () => unregisterSectionHandler();
  }, [sourceList, registerSectionHandler, unregisterSectionHandler]);

  // Reset focus to first item when source tab changes
  useEffect(() => {
    const timer = setTimeout(() => {
      if (listRef.current) {
        listRef.current.scrollTop = 0;
      }
      resetFocus();
    }, 50);
    return () => clearTimeout(timer);
  }, [activeSourceIndex, resetFocus]);

  // Register LT/RT for page jumping (5 items at a time)
  useEffect(() => {
    const PAGE_SIZE = 5;

    const handler = (direction: "prev" | "next"): boolean => {
      const items = listRef.current?.querySelectorAll("[data-bp-focusable]");
      if (!items || items.length === 0) return false;

      const currentIdx = Array.from(items).findIndex(
        (el) => el.getAttribute("data-bp-focused") === "true"
      );

      if (currentIdx < 0) {
        focusNth(0);
        return true;
      }

      const newIdx =
        direction === "prev"
          ? Math.max(0, currentIdx - PAGE_SIZE)
          : Math.min(items.length - 1, currentIdx + PAGE_SIZE);

      focusNth(newIdx);
      return true;
    };

    registerPageHandler(handler);
    return () => unregisterPageHandler();
  }, [focusNth, registerPageHandler, unregisterPageHandler]);

  // Track which item is focused for the position counter
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;

    const updateIndex = () => {
      const items = list.querySelectorAll("[data-bp-focusable]");
      const idx = Array.from(items).findIndex(
        (el) => el.getAttribute("data-bp-focused") === "true"
      );
      setCurrentItemIndex(idx);
    };

    const observer = new MutationObserver(updateIndex);
    observer.observe(list, {
      attributes: true,
      attributeFilter: ["data-bp-focused"],
      subtree: true,
    });

    updateIndex();

    return () => observer.disconnect();
  }, [activeRepacks]);

  if (repacks.length === 0) {
    return (
      <div className="bp-repacks">
        <h2 className="bp-repacks__title">{t("select_repack")}</h2>
        <div className="bp-repacks__empty">{t("no_repacks")}</div>
      </div>
    );
  }

  return (
    <div className="bp-repacks">
      <div className="bp-repacks__header">
        <h2 className="bp-repacks__title">{t("select_repack")}</h2>
        {currentItemIndex >= 0 && (
          <span className="bp-repacks__counter">
            {currentItemIndex + 1} / {activeRepacks.length}
          </span>
        )}
      </div>

      {/* Source tabs — switch with LB/RB */}
      {sourceList.length > 1 && (
        <div className="bp-repacks__tabs">
          <div className="bp-repacks__tabs-hint">
            <span className="bp-repacks__tabs-badge">LB</span>
          </div>
          <div className="bp-repacks__tabs-list">
            {sourceList.map(({ source, repacks: groupRepacks }, index) => (
              <button
                key={source}
                type="button"
                className={`bp-repacks__tab ${
                  index === activeSourceIndex ? "bp-repacks__tab--active" : ""
                }`}
                onClick={() => setActiveSourceIndex(index)}
              >
                <span className="bp-repacks__tab-name">{source}</span>
                <span className="bp-repacks__tab-count">
                  {groupRepacks.length}
                </span>
              </button>
            ))}
          </div>
          <div className="bp-repacks__tabs-hint">
            <span className="bp-repacks__tabs-badge">RB</span>
          </div>
        </div>
      )}

      {/* Single source label when only one source */}
      {sourceList.length === 1 && (
        <div className="bp-repacks__single-source">{sourceList[0].source}</div>
      )}

      {/* Repack list */}
      <div className="bp-repacks__list" ref={listRef}>
        {activeRepacks.map((repack) => {
          const status = getRepackAvailabilityStatus(repack);
          const isLastDownloaded = checkIfLastDownloadedOption(repack);

          return (
            <button
              key={repack.id}
              type="button"
              className={`bp-repacks__item ${
                isLastDownloaded ? "bp-repacks__item--last" : ""
              }`}
              data-bp-focusable
              onClick={() => onSelectRepack(repack)}
            >
              <div className="bp-repacks__item-left">
                <span
                  className={`bp-repacks__dot bp-repacks__dot--${status}`}
                />
                <span className="bp-repacks__item-title">{repack.title}</span>
              </div>

              <div className="bp-repacks__item-right">
                {repack.fileSize && (
                  <span className="bp-repacks__item-size">
                    {repack.fileSize}
                  </span>
                )}
                {repack.uploadDate && (
                  <span className="bp-repacks__item-date">
                    {formatDate(repack.uploadDate)}
                  </span>
                )}
                <span
                  className={`bp-repacks__item-status bp-repacks__item-status--${status}`}
                >
                  {t(`source_${status}`)}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
