import { CircleNotchIcon } from "@phosphor-icons/react";
import { DownloadIcon, TrashIcon } from "@primer/octicons-react";
import { Button } from "@renderer/components";
import { useDate } from "@renderer/hooks";
import { formatBytes } from "@shared";
import type { GameArtifact, LegacySaveExportProgress } from "@types";
import { useTranslation } from "react-i18next";

interface LegacySaveCardProps {
  artifact: GameArtifact;
  isDownloading: boolean;
  downloadProgress: LegacySaveExportProgress | null;
  actionsDisabled: boolean;
  onDownload: (artifactId: string, suggestedName: string) => void;
  onDelete: (artifactId: string, artifactName: string) => void;
}

const formatDownloadProgress = (
  progress: LegacySaveExportProgress | null
): string => {
  if (!progress) return "0%";
  if (progress.percentage === null) {
    return formatBytes(progress.downloadedBytes);
  }

  return `${progress.percentage}%`;
};

export function LegacySaveCard({
  artifact,
  isDownloading,
  downloadProgress,
  actionsDisabled,
  onDownload,
  onDelete,
}: Readonly<LegacySaveCardProps>) {
  const { t } = useTranslation("game_details");
  const { formatDate, formatDateTime } = useDate();
  const artifactName =
    artifact.label ??
    t("backup_from", {
      date: formatDate(artifact.createdAt),
    });
  const downloadProgressLabel = formatDownloadProgress(downloadProgress);

  return (
    <li className="legacy-saves-section__card">
      <div className="legacy-saves-section__card-content">
        <p className="legacy-saves-section__card-name" title={artifactName}>
          {artifactName}
        </p>

        <div className="legacy-saves-section__card-metadata">
          <span>{formatBytes(artifact.artifactLengthInBytes)}</span>
          <span>{formatDateTime(artifact.createdAt)}</span>
          {artifact.hostname && <span>{artifact.hostname}</span>}
          {artifact.downloadOptionTitle && (
            <span>{artifact.downloadOptionTitle}</span>
          )}
        </div>
      </div>

      <div className="legacy-saves-section__card-actions">
        <Button
          type="button"
          theme="outline"
          disabled={actionsDisabled}
          onClick={() => onDownload(artifact.id, artifactName)}
        >
          {isDownloading ? (
            <>
              <CircleNotchIcon
                className="legacy-saves-section__spinner"
                size={16}
              />
              {downloadProgressLabel}
            </>
          ) : (
            <>
              <DownloadIcon />
              {t("download")}
            </>
          )}
        </Button>

        <Button
          type="button"
          theme="danger"
          className="legacy-saves-section__delete-button"
          aria-label={t("delete_backup")}
          disabled={actionsDisabled}
          onClick={() => onDelete(artifact.id, artifactName)}
        >
          <TrashIcon />
        </Button>
      </div>
    </li>
  );
}
