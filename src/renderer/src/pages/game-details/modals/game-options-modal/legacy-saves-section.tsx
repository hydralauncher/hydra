import { cloudSyncContext } from "@renderer/context";
import { ConfirmationModal } from "@renderer/components";
import { useToast } from "@renderer/hooks";
import { CircleNotchIcon } from "@phosphor-icons/react";
import { useCallback, useContext, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { EmulationCloudSave, LegacySaveExportProgress } from "@types";

import { LegacySaveCard } from "./legacy-save-card";
import { deleteLegacyArchiveEntry } from "./legacy-save-actions";
import {
  archivedEmulationSaveToArtifact,
  sortLegacyArchiveEntriesByNewest,
} from "./legacy-save-presentation";
import "./legacy-saves-section.scss";

interface LegacySavesSectionProps {
  downloadingArtifactId: string | null;
  downloadingEmulationSaveId?: string | null;
  downloadProgress: LegacySaveExportProgress | null;
  onDownload: (artifactId: string, suggestedName: string) => void;
  archivedEmulationSaves?: EmulationCloudSave[];
  onDownloadEmulationSave?: (saveId: string) => void;
  onEmulationSaveDeleted?: () => void | Promise<void>;
}

export function LegacySavesSection({
  downloadingArtifactId,
  downloadingEmulationSaveId = null,
  downloadProgress,
  onDownload,
  archivedEmulationSaves = [],
  onDownloadEmulationSave,
  onEmulationSaveDeleted,
}: Readonly<LegacySavesSectionProps>) {
  const { t } = useTranslation("game_details");
  const { artifacts, deleteGameArtifact } = useContext(cloudSyncContext);
  const { showSuccessToast, showErrorToast } = useToast();
  const [pendingDeletion, setPendingDeletion] = useState<{
    artifactId: string;
    artifactName: string;
    source: "game-artifact" | "emulation-save";
  } | null>(null);
  const [deletingArtifactId, setDeletingArtifactId] = useState<string | null>(
    null
  );
  const deletionInProgressRef = useRef(false);
  const sortedEntries = useMemo(
    () =>
      sortLegacyArchiveEntriesByNewest([
        ...artifacts.map((artifact) => ({
          source: "game-artifact" as const,
          artifact,
        })),
        ...archivedEmulationSaves.map((save) => ({
          source: "emulation-save" as const,
          artifact: archivedEmulationSaveToArtifact(save),
        })),
      ]),
    [artifacts, archivedEmulationSaves]
  );

  const handleDelete = useCallback(async () => {
    if (!pendingDeletion || deletionInProgressRef.current) return;

    deletionInProgressRef.current = true;
    setDeletingArtifactId(
      `${pendingDeletion.source}:${pendingDeletion.artifactId}`
    );
    try {
      await deleteLegacyArchiveEntry(
        pendingDeletion.source,
        pendingDeletion.artifactId,
        {
          deleteGameArtifact,
          deleteEmulationSave: window.electron.deleteEmulationSave,
          refreshEmulationSaves: () => onEmulationSaveDeleted?.(),
        }
      );
      setPendingDeletion(null);
      showSuccessToast(t("backup_deleted"));
    } catch {
      showErrorToast(t("backup_deletion_failed"));
    } finally {
      deletionInProgressRef.current = false;
      setDeletingArtifactId(null);
    }
  }, [
    deleteGameArtifact,
    onEmulationSaveDeleted,
    pendingDeletion,
    showErrorToast,
    showSuccessToast,
    t,
  ]);

  const actionsDisabled =
    downloadingArtifactId !== null ||
    downloadingEmulationSaveId !== null ||
    deletingArtifactId !== null;

  return (
    <>
      <div className="legacy-saves-section">
        <div className="game-options-modal__panel-header">
          <h2>{t("settings_category_legacy_saves")}</h2>
          <p>{t("legacy_saves_description")}</p>
        </div>

        <hr className="legacy-saves-section__divider" />

        {sortedEntries.length > 0 ? (
          <ul className="legacy-saves-section__list">
            {sortedEntries.map(({ source, artifact }) => (
              <LegacySaveCard
                key={`${source}:${artifact.id}`}
                artifact={artifact}
                isDownloading={
                  source === "emulation-save"
                    ? downloadingEmulationSaveId === artifact.id
                    : downloadingArtifactId === artifact.id
                }
                downloadProgress={
                  source === "game-artifact" &&
                  downloadingArtifactId === artifact.id
                    ? downloadProgress
                    : null
                }
                showProgress={source === "game-artifact"}
                actionsDisabled={actionsDisabled}
                onDownload={(artifactId, suggestedName) =>
                  source === "emulation-save"
                    ? onDownloadEmulationSave?.(artifactId)
                    : onDownload(artifactId, suggestedName)
                }
                onDelete={(artifactId, artifactName) =>
                  setPendingDeletion({ artifactId, artifactName, source })
                }
              />
            ))}
          </ul>
        ) : (
          <p>{t("no_backups_created")}</p>
        )}
      </div>

      <ConfirmationModal
        visible={pendingDeletion !== null}
        title={t("legacy_save_delete_title")}
        descriptionText={t("legacy_save_delete_description", {
          name: pendingDeletion?.artifactName ?? "",
        })}
        confirmButtonLabel={t(
          deletingArtifactId ? "legacy_save_deleting" : "delete_backup"
        )}
        confirmButtonIcon={
          deletingArtifactId ? (
            <CircleNotchIcon
              className="legacy-saves-section__spinner"
              size={16}
            />
          ) : undefined
        }
        confirmButtonTheme="danger"
        cancelButtonLabel={t("cancel")}
        buttonsIsDisabled={deletingArtifactId !== null}
        clickOutsideToClose={deletingArtifactId === null}
        onConfirm={() => void handleDelete()}
        onClose={() => {
          if (!deletingArtifactId) setPendingDeletion(null);
        }}
      />
    </>
  );
}
