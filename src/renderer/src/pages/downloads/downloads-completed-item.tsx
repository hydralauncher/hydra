import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import type { GameShop, LibraryGame, SeedingStatus } from "@types";
import { formatBytes } from "@shared";
import { buildGameDetailsPath } from "@renderer/helpers";
import { useTranslation } from "react-i18next";
import {
  PlayIcon,
  FileDirectoryIcon,
  TrashIcon,
  DownloadIcon,
} from "@primer/octicons-react";
import "./downloads-completed-item.scss";

interface DownloadsCompletedItemProps {
  game: LibraryGame;
  seedingStatus: SeedingStatus[];
  onOpenInstaller: (shop: GameShop, objectId: string) => void;
  onOpenDeleteModal: (shop: GameShop, objectId: string) => void;
  onResume?: (game: LibraryGame) => void;
  onLaunchGame?: (game: LibraryGame) => void;
}

export function DownloadsCompletedItem({
  game,
  seedingStatus,
  onOpenInstaller,
  onOpenDeleteModal,
  onResume,
  onLaunchGame,
}: Readonly<DownloadsCompletedItemProps>) {
  const { t } = useTranslation("downloads");
  const navigate = useNavigate();

  const coverSrc = useMemo(() => {
    if (game.shop === "steam" && game.objectId) {
      return `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${game.objectId}/header.jpg`;
    }
    return game.libraryHeroImageUrl || game.iconUrl || "";
  }, [game]);

  const size = useMemo(() => {
    return formatBytes(game.download?.fileSize ?? 0);
  }, [game.download?.fileSize]);

  const isSeeding = useMemo(() => {
    return seedingStatus.some(
      (s) =>
        s.gameId === `${game.shop}:${game.objectId}` &&
        (s.status === "seeding" || s.uploadSpeed > 0)
    );
  }, [seedingStatus, game]);

  const isInstalled = Boolean(game.executablePath);
  const isPaused =
    game.download?.status === "paused" ||
    (!isInstalled && (game.download?.progress ?? 0) < 1);

  const handleOpenFolder = () => {
    if (isInstalled && game.executablePath) {
      window.electron.openGameExecutablePath(game.shop, game.objectId);
    } else {
      window.electron.openGameInstallerPath(game.shop, game.objectId);
    }
  };

  const handlePrimaryAction = () => {
    if (isInstalled && onLaunchGame) {
      onLaunchGame(game);
    } else if (isPaused && onResume) {
      onResume(game);
    } else {
      onOpenInstaller(game.shop, game.objectId);
    }
  };

  return (
    <div className="downloads-completed-item">
      <button
        type="button"
        className="downloads-completed-item__cover-btn"
        onClick={() => navigate(buildGameDetailsPath(game))}
      >
        {coverSrc ? (
          <img
            src={coverSrc}
            alt={game.title}
            className="downloads-completed-item__cover"
            loading="lazy"
          />
        ) : (
          <div className="downloads-completed-item__placeholder" />
        )}
      </button>

      <div className="downloads-completed-item__details">
        <button
          type="button"
          className="downloads-completed-item__title-btn"
          onClick={() => navigate(buildGameDetailsPath(game))}
        >
          <span className="downloads-completed-item__title">{game.title}</span>
        </button>

        <div className="downloads-completed-item__meta">
          <span className="downloads-completed-item__size">{size}</span>
          <span className="downloads-completed-item__status">
            {isInstalled
              ? t("installed", { defaultValue: "Instalado" })
              : isPaused
                ? t("paused", { defaultValue: "Pausado" })
                : t("completed", { defaultValue: "Concluído" })}
          </span>
          {isSeeding && (
            <span className="downloads-completed-item__seeding-badge">
              {t("seeding", { defaultValue: "Semeando" })}
            </span>
          )}
        </div>
      </div>

      <div className="downloads-completed-item__actions">
        {isInstalled && onLaunchGame ? (
          <button
            type="button"
            className="downloads-completed-item__action-btn downloads-completed-item__action-btn--play"
            onClick={handlePrimaryAction}
            title={t("play", { defaultValue: "Jogar" })}
          >
            <PlayIcon size={16} />
          </button>
        ) : isPaused ? (
          <button
            type="button"
            className="downloads-completed-item__action-btn downloads-completed-item__action-btn--install"
            onClick={handlePrimaryAction}
            title={t("resume", { defaultValue: "Continuar download" })}
          >
            <DownloadIcon size={16} />
          </button>
        ) : (
          <button
            type="button"
            className="downloads-completed-item__action-btn downloads-completed-item__action-btn--install"
            onClick={handlePrimaryAction}
            title={t("install", { defaultValue: "Instalar" })}
          >
            <DownloadIcon size={16} />
          </button>
        )}

        <button
          type="button"
          className="downloads-completed-item__action-btn"
          onClick={handleOpenFolder}
          title={t("open_folder", { defaultValue: "Abrir pasta" })}
        >
          <FileDirectoryIcon size={15} />
        </button>

        <button
          type="button"
          className="downloads-completed-item__action-btn downloads-completed-item__action-btn--delete"
          onClick={() => onOpenDeleteModal(game.shop, game.objectId)}
          title={t("delete", { defaultValue: "Excluir" })}
        >
          <TrashIcon size={15} />
        </button>
      </div>
    </div>
  );
}
