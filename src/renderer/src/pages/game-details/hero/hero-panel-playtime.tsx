import { useContext, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatDownloadProgress } from "@renderer/helpers";
import { useDate, useDownload, useFormat } from "@renderer/hooks";
import { Link } from "@renderer/components";
import { gameDetailsContext } from "@renderer/context";
import { MAX_MINUTES_TO_SHOW_IN_PLAYTIME } from "@renderer/constants";
import { AlertFillIcon } from "@primer/octicons-react";
import { Tooltip } from "react-tooltip";
import "./hero-panel-playtime.scss";

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
    ["active", "paused"].includes(game.download?.status as string) &&
    game.download?.progress !== 1;

  const isGameDownloading =
    game.download?.status === "active" && lastPacket?.gameId === game.id;

  const downloadInProgressInfo = (
    <div className="hero-panel-playtime__download-details">
      <Link to="/downloads" className="hero-panel-playtime__downloads-link">
        {game.download?.status === "active"
          ? t("download_in_progress")
          : t("download_paused")}
      </Link>

      <small>
        {isGameDownloading
          ? progress
          : formatDownloadProgress(game.download?.progress)}
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
      <p
        className="hero-panel-playtime__play-time"
        data-tooltip-place="top"
        data-tooltip-content={
          game.hasManuallyUpdatedPlaytime
            ? t("manual_playtime_tooltip")
            : undefined
        }
        data-tooltip-id={
          game.hasManuallyUpdatedPlaytime
            ? "manual-playtime-warning"
            : undefined
        }
      >
        {game.hasManuallyUpdatedPlaytime && (
          <AlertFillIcon
            size={16}
            className="hero-panel-playtime__manual-warning"
          />
        )}
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

      {game.hasManuallyUpdatedPlaytime && (
        <Tooltip
          id="manual-playtime-warning"
          style={{
            zIndex: 9999,
          }}
          openOnClick={false}
        />
      )}
    </>
  );
}
