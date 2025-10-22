import { useContext, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { createPortal } from "react-dom";

import { useDate, useDownload } from "@renderer/hooks";

import { HeroPanelActions } from "./hero-panel-actions";
import { HeroPanelPlaytime } from "./hero-panel-playtime";

import { gameDetailsContext } from "@renderer/context";
import "./hero-panel.scss";

export function HeroPanel() {
  const heroPanelRef = useRef<HTMLDivElement>(null);
  const [isSticky, setIsSticky] = useState(false);
  const { t } = useTranslation("game_details");

  const { formatDate } = useDate();

  const { game, repacks } = useContext(gameDetailsContext);

  const { lastPacket } = useDownload();

  const isGameDownloading =
    game?.download?.status === "active" && lastPacket?.gameId === game?.id;

  const getInfo = () => {
    if (!game) {
      const [latestRepack] = repacks;

      if (latestRepack) {
        const lastUpdate = latestRepack.uploadDate
          ? formatDate(latestRepack.uploadDate!)
          : "";
        const repacksCount = repacks.length;

        return (
          <>
            <p>{t("updated_at", { updated_at: lastUpdate })}</p>
            <p>{t("download_options", { count: repacksCount })}</p>
          </>
        );
      }

      return <p>{t("no_downloads")}</p>;
    }

    return <HeroPanelPlaytime />;
  };

  const showProgressBar =
    (game?.download?.status === "active" && game?.download?.progress < 1) ||
    game?.download?.status === "paused";

  // Отслеживаем скролл для sticky поведения
  useEffect(() => {
    if (!heroPanelRef.current) return undefined;

    const handleScroll = () => {
      if (!heroPanelRef.current) return;

      const rect = heroPanelRef.current.getBoundingClientRect();
      const containerContent = document.querySelector(".container__content");

      if (containerContent) {
        const containerRect = containerContent.getBoundingClientRect();
        // Панель должна стать sticky когда она уходит за пределы видимости
        setIsSticky(rect.bottom < containerRect.top);
      }
    };

    const containerContent = document.querySelector(".container__content");
    if (containerContent) {
      containerContent.addEventListener("scroll", handleScroll);
      handleScroll(); // Проверяем сразу

      return () => {
        containerContent.removeEventListener("scroll", handleScroll);
      };
    }

    return undefined;
  }, []);

  const heroPanelContent = (
    <>
      <div className="hero-panel__content">{getInfo()}</div>
      <div className="hero-panel__actions">
        <HeroPanelActions />
      </div>

      {showProgressBar && (
        <progress
          max={1}
          value={
            isGameDownloading ? lastPacket?.progress : game?.download?.progress
          }
          className={`hero-panel__progress-bar ${
            game?.download?.status === "paused"
              ? "hero-panel__progress-bar--disabled"
              : ""
          }`}
        />
      )}
    </>
  );

  return (
    <>
      {/* Оригинальная панель на своем месте */}
      <div ref={heroPanelRef} className="hero-panel">
        {heroPanelContent}
      </div>

      {/* Sticky копия в header при скролле */}
      {isSticky &&
        createPortal(
          <div className="hero-panel hero-panel--sticky">
            {heroPanelContent}
          </div>,
          document.getElementById("hero-panel-sticky-container") ||
            document.body
        )}
    </>
  );
}
