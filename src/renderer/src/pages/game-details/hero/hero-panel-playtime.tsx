import { useContext, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatDownloadProgress } from "@renderer/helpers";
import {
  useAppSelector,
  useDate,
  useDownload,
  useFormat,
} from "@renderer/hooks";
import { Link } from "@renderer/components";
import { gameDetailsContext } from "@renderer/context";
import { MAX_MINUTES_TO_SHOW_IN_PLAYTIME } from "@renderer/constants";
import { AlertFillIcon } from "@primer/octicons-react";
import { Tooltip } from "react-tooltip";
import SteamLogo from "@renderer/assets/steam-logo.svg?react";
import "./hero-panel-playtime.scss";

export function HeroPanelPlaytime() {
  const [lastTimePlayed, setLastTimePlayed] = useState("");

  const { game, isGameRunning, updateGame } = useContext(gameDetailsContext);
  const { t } = useTranslation("game_details");
  const { numberFormatter } = useFormat();
  const { progress, lastPacket } = useDownload();
  const { formatDistance } = useDate();
  const extraction = useAppSelector((state) => state.download.extraction);

  const isExtracting = extraction?.visibleId === game?.id;

  useEffect(() => {
    if (game?.lastTimePlayed) {
      setLastTimePlayed(
        formatDistance(game.lastTimePlayed, new Date(), {
          addSuffix: true,
        })
      );
    }
  }, [game?.lastTimePlayed, formatDistance]);

  const isSteamManagedGame = Boolean(game?.launchThroughSteam);

  useEffect(() => {
    // Steam updates its local playtime files when a game session ends, so
    // refresh the stat whenever the details of a Steam-managed game open.
    if (!isSteamManagedGame) return;

    window.electron
      .syncSteamPlaytime()
      .then((updatedCount) => {
        if (updatedCount > 0) updateGame();
      })
      .catch(() => {});
  }, [isSteamManagedGame, game?.objectId, updateGame]);

  const formatPlaytimeAmount = useMemo(() => {
    return (milliseconds: number) => {
      const minutes = milliseconds / 1000 / 60;

      if (minutes < MAX_MINUTES_TO_SHOW_IN_PLAYTIME) {
        return t("amount_minutes", {
          amount: minutes.toFixed(0),
        });
      }

      const hours = minutes / 60;
      return t("amount_hours", { amount: numberFormatter.format(hours) });
    };
  }, [numberFormatter, t]);

  const formattedPlayTime = useMemo(
    () => formatPlaytimeAmount(game?.playTimeInMilliseconds || 0),
    [game?.playTimeInMilliseconds, formatPlaytimeAmount]
  );

  const steamPlaytime = game?.steamPlayTimeInMilliseconds ?? 0;

  const steamPlaytimeInfo =
    steamPlaytime > 0 ? (
      <p className="hero-panel-playtime__steam-playtime">
        <SteamLogo width={16} height={16} />
        {t("steam_play_time", {
          amount: formatPlaytimeAmount(steamPlaytime),
        })}
      </p>
    ) : null;

  if (!game) return null;

  const hasDownload =
    ["active", "paused"].includes(game.download?.status as string) &&
    game.download?.progress !== 1;

  const isGameDownloading =
    game.download?.status === "active" && lastPacket?.gameId === game.id;

  const extractionInProgressInfo = (
    <div className="hero-panel-playtime__download-details">
      <Link to="/downloads" className="hero-panel-playtime__downloads-link">
        {t("extracting")}
      </Link>

      <small>{formatDownloadProgress(extraction?.progress ?? 0)}</small>
    </div>
  );

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
        {steamPlaytimeInfo}
        {isExtracting && extractionInProgressInfo}
        {!isExtracting && hasDownload && downloadInProgressInfo}
      </>
    );
  }

  if (isGameRunning) {
    return (
      <>
        <p>{t("playing_now")}</p>
        {steamPlaytimeInfo}
        {isExtracting && extractionInProgressInfo}
        {!isExtracting && hasDownload && downloadInProgressInfo}
      </>
    );
  }

  return (
    <>
      <p
        className="hero-panel-playtime__play-time"
        data-tooltip-place="right"
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

      {steamPlaytimeInfo}

      {isExtracting && extractionInProgressInfo}
      {!isExtracting && hasDownload && downloadInProgressInfo}
      {!isExtracting && !hasDownload && (
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
