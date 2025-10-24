import { useContext } from "react";
import { useTranslation } from "react-i18next";

import { useDate, useDownload } from "@renderer/hooks";

import { HeroPanelActions } from "./hero-panel-actions";
import { HeroPanelPlaytime } from "./hero-panel-playtime";

import { gameDetailsContext } from "@renderer/context";
import "./hero-panel.scss";

export function HeroPanel() {
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
                : game?.download?.progress
            }
            className={`hero-panel__progress-bar ${
              game?.download?.status === "paused"
                ? "hero-panel__progress-bar--disabled"
                : ""
            }`}
          />
        )}
      </div>
    </div>
  );
}
