import { cloudSyncContext } from "@renderer/context";
import { ConfirmationModal } from "@renderer/components";
import { useToast } from "@renderer/hooks";
import { CircleNotchIcon } from "@phosphor-icons/react";
import { useCallback, useContext, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { LegacySaveCard } from "./legacy-save-card";
import { sortLegacySavesByNewest } from "./legacy-save-presentation";
import "./legacy-saves-section.scss";

export function LegacySavesSection() {
  const { t } = useTranslation("game_details");
  const { artifacts, deleteGameArtifact } = useContext(cloudSyncContext);
  const { showSuccessToast, showErrorToast } = useToast();
  const [downloadingArtifactId, setDownloadingArtifactId] = useState<
    string | null
  >(null);
  const [pendingDeletion, setPendingDeletion] = useState<{
    artifactId: string;
    artifactName: string;
  } | null>(null);
  const [deletingArtifactId, setDeletingArtifactId] = useState<string | null>(
    null
  );
  const actionInProgressRef = useRef(false);
  const sortedArtifacts = useMemo(
    () => sortLegacySavesByNewest(artifacts),
    [artifacts]
  );

  const handleDownload = useCallback(
    async (artifactId: string, suggestedName: string) => {
      if (actionInProgressRef.current) return;

      actionInProgressRef.current = true;
      setDownloadingArtifactId(artifactId);
      try {
        const result = await window.electron.exportGameArtifact(
          artifactId,
          suggestedName
        );

        if (result.status === "saved") {
          showSuccessToast(t("legacy_save_download_success"));
        }
      } catch {
        showErrorToast(t("legacy_save_download_failed"));
      } finally {
        actionInProgressRef.current = false;
        setDownloadingArtifactId(null);
      }
    },
    [showErrorToast, showSuccessToast, t]
  );

  const handleDelete = useCallback(async () => {
    if (!pendingDeletion || actionInProgressRef.current) return;

    actionInProgressRef.current = true;
    setDeletingArtifactId(pendingDeletion.artifactId);
    try {
      await deleteGameArtifact(pendingDeletion.artifactId);
      setPendingDeletion(null);
      showSuccessToast(t("backup_deleted"));
    } catch {
      showErrorToast(t("backup_deletion_failed"));
    } finally {
      actionInProgressRef.current = false;
      setDeletingArtifactId(null);
    }
  }, [
    deleteGameArtifact,
    pendingDeletion,
    showErrorToast,
    showSuccessToast,
    t,
  ]);

  const actionsDisabled =
    downloadingArtifactId !== null || deletingArtifactId !== null;

  return (
    <>
      <div className="legacy-saves-section">
        <div className="game-options-modal__panel-header">
          <h2>{t("settings_category_legacy_saves")}</h2>
          <p>{t("legacy_saves_description")}</p>
        </div>

        {sortedArtifacts.length > 0 ? (
          <ul className="legacy-saves-section__list">
            {sortedArtifacts.map((artifact) => (
              <LegacySaveCard
                key={artifact.id}
                artifact={artifact}
                isDownloading={downloadingArtifactId === artifact.id}
                actionsDisabled={actionsDisabled}
                onDownload={handleDownload}
                onDelete={(artifactId, artifactName) =>
                  setPendingDeletion({ artifactId, artifactName })
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
