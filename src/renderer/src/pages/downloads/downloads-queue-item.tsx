import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import type { LibraryGame } from "@types";
import { formatBytes } from "@shared";
import { buildGameDetailsPath } from "@renderer/helpers";
import { useTranslation } from "react-i18next";
import {
  DownloadIcon,
  XIcon,
  ArrowUpIcon,
  ArrowDownIcon,
} from "@primer/octicons-react";
import { DOWNLOADER_NAME } from "@renderer/constants";
import "./downloads-queue-item.scss";

interface DownloadsQueueItemProps {
  game: LibraryGame;
  onResume: (game: LibraryGame) => void;
  onCancel: (game: LibraryGame) => void;
  onMoveUp?: (game: LibraryGame) => void;
  onMoveDown?: (game: LibraryGame) => void;
  isFirst?: boolean;
  isLast?: boolean;
}

export function DownloadsQueueItem({
  game,
  onResume,
  onCancel,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
}: Readonly<DownloadsQueueItemProps>) {
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

  const downloaderName = useMemo(() => {
    if (!game.download?.downloader) return null;
    return DOWNLOADER_NAME[Number(game.download.downloader)];
  }, [game.download?.downloader]);

  return (
    <div className="downloads-queue-item">
      <button
        type="button"
        className="downloads-queue-item__cover-btn"
        onClick={() => navigate(buildGameDetailsPath(game))}
      >
        {coverSrc ? (
          <img
            src={coverSrc}
            alt={game.title}
            className="downloads-queue-item__cover"
            loading="lazy"
          />
        ) : (
          <div className="downloads-queue-item__placeholder" />
        )}
      </button>

      <div className="downloads-queue-item__details">
        <button
          type="button"
          className="downloads-queue-item__title-btn"
          onClick={() => navigate(buildGameDetailsPath(game))}
        >
          <span className="downloads-queue-item__title">{game.title}</span>
        </button>

        <div className="downloads-queue-item__meta">
          <span className="downloads-queue-item__size">{size}</span>
          {downloaderName && (
            <span className="downloads-queue-item__badge">
              {downloaderName}
            </span>
          )}
        </div>
      </div>

      <div className="downloads-queue-item__actions">
        {onMoveUp && !isFirst && (
          <button
            type="button"
            className="downloads-queue-item__action-btn"
            onClick={() => onMoveUp(game)}
            title={t("move_up", { defaultValue: "Mover para cima" })}
          >
            <ArrowUpIcon size={14} />
          </button>
        )}

        {onMoveDown && !isLast && (
          <button
            type="button"
            className="downloads-queue-item__action-btn"
            onClick={() => onMoveDown(game)}
            title={t("move_down", { defaultValue: "Mover para baixo" })}
          >
            <ArrowDownIcon size={14} />
          </button>
        )}

        <button
          type="button"
          className="downloads-queue-item__action-btn downloads-queue-item__action-btn--download"
          onClick={() => onResume(game)}
          title={t("download_now", { defaultValue: "Baixar agora" })}
        >
          <DownloadIcon size={16} />
        </button>

        <button
          type="button"
          className="downloads-queue-item__action-btn downloads-queue-item__action-btn--cancel"
          onClick={() => onCancel(game)}
          title={t("cancel", { defaultValue: "Cancelar" })}
        >
          <XIcon size={16} />
        </button>
      </div>
    </div>
  );
}
