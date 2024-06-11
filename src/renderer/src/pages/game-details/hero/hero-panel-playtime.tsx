import { useContext, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import * as styles from "./hero-panel.css";
import { formatDownloadProgress } from "@renderer/helpers";
import { useDate, useDownload } from "@renderer/hooks";
import { Link } from "@renderer/components";

import { gameDetailsContext } from "@renderer/context";

const MAX_MINUTES_TO_SHOW_IN_PLAYTIME = 120;

export function HeroPanelPlaytime() {
  const [lastTimePlayed, setLastTimePlayed] = useState("");

  const { game, isGameRunning } = useContext(gameDetailsContext);

  const { i18n, t } = useTranslation("game_details");

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

  const numberFormatter = useMemo(() => {
    return new Intl.NumberFormat(i18n.language, {
      maximumFractionDigits: 0,
    });
  }, [i18n.language]);

  const formatPlayTime = () => {
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
  };

  if (!game) return null;

  const hasDownload =
    ["active", "paused"].includes(game.status) && game.progress !== 1;

  const isGameDownloading =
    game.status === "active" && lastPacket?.game.id === game.id;

  const downloadInProgressInfo = (
    <div className={styles.downloadDetailsRow}>
      <Link to="/downloads" className={styles.downloadsLink}>
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
          amount: formatPlayTime(),
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
