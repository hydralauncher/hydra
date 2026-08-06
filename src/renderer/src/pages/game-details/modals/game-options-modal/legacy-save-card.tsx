import { CircleNotchIcon } from "@phosphor-icons/react";
import { DownloadIcon, TrashIcon } from "@primer/octicons-react";
import { Button } from "@renderer/components";
import { useDate } from "@renderer/hooks";
import { formatBytes } from "@shared";
import type { GameArtifact } from "@types";
import { useTranslation } from "react-i18next";

interface LegacySaveCardProps {
  artifact: GameArtifact;
  isDownloading: boolean;
  actionsDisabled: boolean;
  onDownload: (artifactId: string, suggestedName: string) => void;
}

export function LegacySaveCard({
  artifact,
  isDownloading,
  actionsDisabled,
  onDownload,
}: Readonly<LegacySaveCardProps>) {
  const { t } = useTranslation("game_details");
  const { formatDate, formatDateTime } = useDate();
  const artifactName =
    artifact.label ??
    t("backup_from", {
      date: formatDate(artifact.createdAt),
    });

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
              {t("legacy_save_downloading")}
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
        >
          <TrashIcon />
        </Button>
      </div>
    </li>
  );
}
