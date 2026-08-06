import { cloudSyncContext } from "@renderer/context";
import { useToast } from "@renderer/hooks";
import { useCallback, useContext, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { LegacySaveCard } from "./legacy-save-card";
import { sortLegacySavesByNewest } from "./legacy-save-presentation";
import "./legacy-saves-section.scss";

export function LegacySavesSection() {
  const { t } = useTranslation("game_details");
  const { artifacts } = useContext(cloudSyncContext);
  const { showSuccessToast, showErrorToast } = useToast();
  const [downloadingArtifactId, setDownloadingArtifactId] = useState<
    string | null
  >(null);
  const downloadInProgressRef = useRef(false);
  const sortedArtifacts = useMemo(
    () => sortLegacySavesByNewest(artifacts),
    [artifacts]
  );

  const handleDownload = useCallback(
    async (artifactId: string, suggestedName: string) => {
      if (downloadInProgressRef.current) return;

      downloadInProgressRef.current = true;
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
        downloadInProgressRef.current = false;
        setDownloadingArtifactId(null);
      }
    },
    [showErrorToast, showSuccessToast, t]
  );

  return (
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
              actionsDisabled={downloadingArtifactId !== null}
              onDownload={handleDownload}
            />
          ))}
        </ul>
      ) : (
        <p>{t("no_backups_created")}</p>
      )}
    </div>
  );
}
