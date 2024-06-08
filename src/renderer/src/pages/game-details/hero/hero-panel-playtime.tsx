import { useContext, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import * as styles from "./hero-panel.css";
import { formatDownloadProgress } from "@renderer/helpers";
import { useDate, useDownload } from "@renderer/hooks";
import { gameDetailsContext } from "../game-details.context";
import { Link } from "@renderer/components";

const MAX_MINUTES_TO_SHOW_IN_PLAYTIME = 120;

export function HeroPanelPlaytime() {
  const [lastTimePlayed, setLastTimePlayed] = useState("");

  const { game, isGameRunning } = useContext(gameDetailsContext);

  const { i18n, t } = useTranslation("game_details");

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

  const { progress, lastPacket } = useDownload();

  const isGameDownloading =
    game?.status === "active" && lastPacket?.game.id === game?.id;

  if (!game) return;

  let downloadContent: JSX.Element | null = null;

  if (game.status === "active") {
    if (lastPacket?.isDownloadingMetadata && isGameDownloading) {
      downloadContent = <p>{t("downloading_metadata")}</p>;
    } else if (game.progress !== 1) {
      downloadContent = (
        <div className={styles.downloadDetailsRow}>
          <Link to="/downloads" className={styles.downloadsLink}>
            Download em andamento
          </Link>

          <small>
            {isGameDownloading
              ? progress
              : formatDownloadProgress(game.progress)}
          </small>
        </div>
      );
    }
  }

  if (!game.lastTimePlayed) {
    return (
      <>
        <p>{t("not_played_yet", { title: game?.title })}</p>
        {downloadContent}
      </>
    );
  }

  if (isGameRunning) {
    return (
      <>
        {downloadContent || (
          <p>
            {t("play_time", {
              amount: formatPlayTime(),
            })}
          </p>
        )}

        <p>{t("playing_now")}</p>
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

      {downloadContent || (
        <p>
          {t("last_time_played", {
            period: lastTimePlayed,
          })}
        </p>
      )}
    </>
  );
}
