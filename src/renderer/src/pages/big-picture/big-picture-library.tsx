import { useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useLibrary, useDownload, useAppSelector } from "@renderer/hooks";
import type { GameShop, LibraryGame } from "@types";
import { BigPictureGameCard } from "./big-picture-game-card";
import "./big-picture-library.scss";

export default function BigPictureLibrary() {
  const { t } = useTranslation("big_picture");
  const { library } = useLibrary();
  const { lastPacket, progress } = useDownload();
  const gameRunning = useAppSelector((state) => state.gameRunning.gameRunning);
  const navigate = useNavigate();

  const getDownloadProgress = useCallback(
    (gameId: string) => {
      if (lastPacket?.gameId === gameId) {
        return { raw: lastPacket.progress, formatted: progress };
      }
      return null;
    },
    [lastPacket, progress]
  );

  const handleGameClick = useCallback(
    (game: { shop: GameShop; objectId: string; title: string }) => {
      navigate(`/big-picture/game/${game.shop}/${game.objectId}`);
    },
    [navigate]
  );

  const { featuredGame, sortedLibrary } = useMemo(() => {
    // Featured game: currently running, or the most recently played
    const running = library.filter((g) => gameRunning?.id === g.id);
    let featured: LibraryGame | null = null;
    if (running.length > 0) {
      featured = running[0];
    } else if (library.length > 0) {
      const withPlaytime = library.filter(
        (g) => g.lastTimePlayed || g.playTimeInMilliseconds > 0
      );
      if (withPlaytime.length > 0) {
        featured = withPlaytime.sort((a, b) => {
          const aTime = a.lastTimePlayed
            ? new Date(a.lastTimePlayed).getTime()
            : 0;
          const bTime = b.lastTimePlayed
            ? new Date(b.lastTimePlayed).getTime()
            : 0;
          return bTime - aTime;
        })[0];
      }
    }

    // Sort: running first, then installed, then not installed
    const sorted = [...library].sort((a, b) => {
      const aRunning = gameRunning?.id === a.id ? 0 : 1;
      const bRunning = gameRunning?.id === b.id ? 0 : 1;
      if (aRunning !== bRunning) return aRunning - bRunning;

      const aInstalled = a.executablePath ? 0 : 1;
      const bInstalled = b.executablePath ? 0 : 1;
      return aInstalled - bInstalled;
    });

    return { featuredGame: featured, sortedLibrary: sorted };
  }, [library, gameRunning]);

  const formatPlaytime = (ms: number) => {
    const hours = Math.floor(ms / 3_600_000);
    if (hours > 0) return `${hours}h`;
    const minutes = Math.floor(ms / 60_000);
    return `${minutes}m`;
  };

  if (library.length === 0) {
    return (
      <div className="bp-library__empty">
        <h2>{t("no_games")}</h2>
      </div>
    );
  }

  const isRunning = (game: LibraryGame) => gameRunning?.id === game.id;

  return (
    <div className="bp-library">
      {featuredGame && (
        <button
          type="button"
          className="bp-library__hero"
          data-bp-focusable
          onClick={() => handleGameClick(featuredGame)}
        >
          <img
            src={
              featuredGame.customHeroImageUrl ||
              featuredGame.libraryHeroImageUrl ||
              featuredGame.coverImageUrl ||
              ""
            }
            alt=""
            className="bp-library__hero-image"
          />
          <div className="bp-library__hero-overlay" />
          <div className="bp-library__hero-content">
            {isRunning(featuredGame) ? (
              <div className="bp-library__hero-badge">{t("game_running")}</div>
            ) : (
              featuredGame.playTimeInMilliseconds > 0 && (
                <div className="bp-library__hero-badge">
                  {t("continue_playing")}
                </div>
              )
            )}
            <h2 className="bp-library__hero-title">{featuredGame.title}</h2>
            {featuredGame.playTimeInMilliseconds > 0 && (
              <span className="bp-library__hero-subtitle">
                {t("playtime")}:{" "}
                {formatPlaytime(featuredGame.playTimeInMilliseconds)}
              </span>
            )}
          </div>
        </button>
      )}

      <div className="bp-library__section-heading">
        <h2>{t("library")}</h2>
      </div>

      <div className="bp-library__grid">
        {sortedLibrary.map((game, index) => (
          <BigPictureGameCard
            key={game.id}
            game={game}
            onClick={() => handleGameClick(game)}
            isRunning={isRunning(game)}
            isInstalled={Boolean(game.executablePath)}
            isAvailable={(game.downloadSources?.length ?? 0) > 0}
            downloadProgress={getDownloadProgress(game.id)}
            index={index}
          />
        ))}
      </div>
    </div>
  );
}
