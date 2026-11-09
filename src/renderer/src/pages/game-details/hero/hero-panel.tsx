import { useContext } from "react";
import { useTranslation } from "react-i18next";

import { useAppSelector, useDate, useDownload } from "@renderer/hooks";

import { HeroPanelActions } from "./hero-panel-actions";
import { HeroPanelPlaytime } from "./hero-panel-playtime";

import { gameDetailsContext } from "@renderer/context";
import "./hero-panel.scss";

export function HeroPanel() {
  const { t } = useTranslation("game_details");

  const { formatDate } = useDate();

  const { game, downloadGame, repacks } = useContext(gameDetailsContext);

  const { lastPacket } = useDownload();

  const extraction = useAppSelector((state) => state.download.extraction);

  const isGameDownloading =
    downloadGame?.download?.status === "active" &&
    lastPacket?.gameId === downloadGame?.id;

  const isExtracting = extraction?.visibleId === downloadGame?.id;

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
    (downloadGame?.download?.status === "active" &&
      downloadGame.download.progress < 1) ||
    downloadGame?.download?.status === "paused";

  const showExtractionProgressBar = isExtracting;

  return (
    <div className="hero-panel__container">
      <div className="hero-panel">
        <div className="hero-panel__content">{getInfo()}</div>
        <div className="hero-panel__actions">
          <HeroPanelActions />
        </div>

        {showProgressBar && (
          <progress
            max={1}
            value={
              isGameDownloading
                ? lastPacket?.progress
                : downloadGame?.download?.progress
            }
            className={`hero-panel__progress-bar ${
              downloadGame?.download?.status === "paused"
                ? "hero-panel__progress-bar--disabled"
                : ""
            }`}
          />
        )}

        {showExtractionProgressBar && (
          <progress
            max={1}
            value={extraction?.progress ?? 0}
            className="hero-panel__progress-bar hero-panel__progress-bar--extraction"
          />
        )}
      </div>
    </div>
  );
}
