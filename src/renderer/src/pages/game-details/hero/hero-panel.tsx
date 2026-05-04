import { useContext } from "react";
import { useTranslation } from "react-i18next";
import cn from "classnames";

import { useAppSelector, useDate, useDownload } from "@renderer/hooks";

import { HeroPanelActions } from "./hero-panel-actions";
import { HeroPanelPlaytime } from "./hero-panel-playtime";

import { gameDetailsContext } from "@renderer/context";
import "./hero-panel.scss";

export function HeroPanel() {
  const { t } = useTranslation("game_details");

  const { formatDate } = useDate();

  const { game, repacks } = useContext(gameDetailsContext);

  const { lastPacket } = useDownload();

  const extraction = useAppSelector((state) => state.download.extraction);

  const isGameDownloading =
    game?.download?.status === "active" && lastPacket?.gameId === game?.id;

  const isExtracting = extraction?.visibleId === game?.id;

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

  const isPaused = game?.download?.status === "paused";

  const downloadProgress = isGameDownloading
    ? (lastPacket?.progress ?? 0)
    : (game?.download?.progress ?? 0);

  return (
    <div className="hero-panel__container">
      <div
        className={cn("hero-panel", {
          "hero-panel--downloading": showProgressBar && !isPaused,
          "hero-panel--extracting": isExtracting,
          "hero-panel--paused": isPaused,
        })}
      >
        {showProgressBar && (
          <div
            className={cn("hero-panel__progress", {
              "hero-panel__progress--paused": isPaused,
            })}
            style={{ width: `${downloadProgress * 100}%` }}
          />
        )}

        {isExtracting && (
          <div
            className="hero-panel__progress hero-panel__progress--extraction"
            style={{ width: `${(extraction?.progress ?? 0) * 100}%` }}
          />
        )}

        <div className="hero-panel__content">{getInfo()}</div>
        <div className="hero-panel__actions">
          <HeroPanelActions />
        </div>
      </div>
    </div>
  );
}
