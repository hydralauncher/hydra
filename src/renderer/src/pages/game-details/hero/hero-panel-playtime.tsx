import { useContext, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import "./hero-panel.scss"
import { formatDownloadProgress } from "@renderer/helpers";
import { useDate, useDownload, useFormat } from "@renderer/hooks";
import { Link } from "@renderer/components";

import { gameDetailsContext } from "@renderer/context";
import { MAX_MINUTES_TO_SHOW_IN_PLAYTIME } from "@renderer/constants";

export function HeroPanelPlaytime() {
  const [lastTimePlayed, setLastTimePlayed] = useState("");

  const { game, isGameRunning } = useContext(gameDetailsContext);

  const { t } = useTranslation("game_details");

  const { numberFormatter } = useFormat();

  const { progress, lastPacket } = useDownload();

  const { formatDistance } = useDate();

  useEffect(() => {
    if (game?.lastTimePlayed) {
      setLastTimePlayed(
        formatDistance(game.lastTimePlayed, new Date(), {
          addSuffix: true,
        })
      );
    }
  }, [game?.lastTimePlayed, formatDistance]);

  const formattedPlayTime = useMemo(() => {
    const milliseconds = game?.playTimeInMilliseconds || 0;
    const seconds = milliseconds / 1000;
    const minutes = seconds / 60;

    if (minutes < MAX_MINUTES_TO_SHOW_IN_PLAYTIME) {
      return t("amount_minutes", {
        amount: minutes.toFixed(0),
      });
    }

    const hours = minutes / 60;
    return t("amount_hours", { amount: numberFormatter.format(hours) });
  }, [game?.playTimeInMilliseconds, numberFormatter, t]);

  if (!game) return null;

  const hasDownload =
    ["active", "paused"].includes(game.status as string) && game.progress !== 1;

  const isGameDownloading =
    game.status === "active" && lastPacket?.game.id === game.id;

  const downloadInProgressInfo = (
    <div className="hero-panel__download-details-row">
      <Link to="/downloads" className="hero-panel__downloads-link">
        {game.status === "active"
          ? t("download_in_progress")
          : t("download_paused")}
      </Link>

      <small>
        {isGameDownloading ? progress : formatDownloadProgress(game.progress)}
      </small>
    </div>
  );

  if (!game.lastTimePlayed) {
    return (
      <>
        <p>{t("not_played_yet", { title: game?.title })}</p>
        {hasDownload && downloadInProgressInfo}
      </>
    );
  }

  if (isGameRunning) {
    return (
      <>
        <p>{t("playing_now")}</p>

        {hasDownload && downloadInProgressInfo}
      </>
    );
  }

  return (
    <>
      <p>
        {t("play_time", {
          amount: formattedPlayTime,
        })}
      </p>

      {hasDownload ? (
        downloadInProgressInfo
      ) : (
        <p>
          {t("last_time_played", {
            period: lastTimePlayed,
          })}
        </p>
      )}
    </>
  );
}
