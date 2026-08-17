import { useContext, useEffect, useMemo, useState } from "react";
import { Reorder } from "framer-motion";

import { Button, ConfirmationModal } from "@renderer/components";
import { useTranslation } from "react-i18next";

import type { DownloadSource } from "@types";
import { PlusCircleIcon, SyncIcon, TrashIcon } from "@primer/octicons-react";
import { AddDownloadSourceModal } from "./add-download-source-modal";
import { useAppDispatch, useAppSelector, useToast } from "@renderer/hooks";
import { settingsContext } from "@renderer/context";
import { useNavigate } from "react-router-dom";
import { setFilters, clearFilters } from "@renderer/features";
import { levelDBService } from "@renderer/services/leveldb.service";
import { orderBy } from "lodash-es";
import { DownloadSourceCard } from "./download-source-card";
import { SettingsDownloadSourcesAutoOptions } from "./settings-download-sources-auto-options";
import { getSortedSourcesByPriority } from "@renderer/helpers";
import { logger } from "@renderer/logger";
import "./settings-download-sources.scss";

export function SettingsDownloadSources() {
  const [showConfirmDeleteAll, setShowConfirmDeleteAll] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [downloadSources, setDownloadSources] = useState<DownloadSource[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);

  const { sourceUrl, clearSourceUrl, updateUserPreferences } =
    useContext(settingsContext);
  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );
  const { t } = useTranslation("settings");
  const { showSuccessToast } = useToast();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();

  useEffect(() => {
    if (sourceUrl) setShowAddModal(true);
  }, [sourceUrl]);

  useEffect(() => {
    const fetchSources = async () => {
      const sources = (await levelDBService.values(
        "downloadSources"
      )) as DownloadSource[];
      setDownloadSources(orderBy(sources, "createdAt", "desc"));
    };
    fetchSources();
  }, []);

  const refreshSources = async () => {
    const sources = (await levelDBService.values(
      "downloadSources"
    )) as DownloadSource[];
    setDownloadSources(orderBy(sources, "createdAt", "desc"));
  };

  const handleRemoveSource = async (source: DownloadSource) => {
    setIsRemoving(true);
    try {
      await window.electron.removeDownloadSource(false, source.id);
      await refreshSources();
      showSuccessToast(t("removed_download_source"));
    } catch (err) {
      logger.error("Failed to remove download source:", err);
    } finally {
      setIsRemoving(false);
    }
  };

  const handleRemoveAll = async () => {
    setIsRemoving(true);
    try {
      await window.electron.removeDownloadSource(true);
      await refreshSources();
      showSuccessToast(t("removed_all_download_sources"));
    } catch (err) {
      logger.error("Failed to remove all download sources:", err);
    } finally {
      setIsRemoving(false);
      setShowConfirmDeleteAll(false);
    }
  };

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      await window.electron.syncDownloadSources();
      await refreshSources();
      showSuccessToast(t("download_sources_synced_successfully"));
    } finally {
      setIsSyncing(false);
    }
  };

  const navigateToCatalogue = (fingerprint?: string) => {
    if (!fingerprint) return;
    dispatch(clearFilters());
    dispatch(setFilters({ downloadSourceFingerprints: [fingerprint] }));
    navigate("/catalogue");
  };

  const isPriorityEnabled = Boolean(
    userPreferences?.autoDownloadBySourcePriority
  );

  const displaySources = useMemo(() => {
    if (!isPriorityEnabled) return downloadSources;
    return getSortedSourcesByPriority(
      downloadSources,
      userPreferences?.downloadSourcesPriority
    );
  }, [
    downloadSources,
    isPriorityEnabled,
    userPreferences?.downloadSourcesPriority,
  ]);

  const handleMovePriority = (index: number, direction: "up" | "down") => {
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= displaySources.length) return;

    const newSources = [...displaySources];
    const temp = newSources[index];
    newSources[index] = newSources[targetIndex];
    newSources[targetIndex] = temp;

    const newPriorityIds = newSources.map((s) => s.id);
    updateUserPreferences({ downloadSourcesPriority: newPriorityIds });
  };

  const handleReorder = (newSources: DownloadSource[]) => {
    const newPriorityIds = newSources.map((s) => s.id);
    updateUserPreferences({ downloadSourcesPriority: newPriorityIds });
  };

  return (
    <>
      <AddDownloadSourceModal
        visible={showAddModal}
        onClose={() => {
          clearSourceUrl();
          setShowAddModal(false);
        }}
        onAddDownloadSource={refreshSources}
      />

      <ConfirmationModal
        cancelButtonLabel={t("cancel_button_confirmation_delete_all_sources")}
        confirmButtonLabel={t("confirm_button_confirmation_delete_all_sources")}
        descriptionText={t("description_confirmation_delete_all_sources")}
        clickOutsideToClose={false}
        onConfirm={handleRemoveAll}
        visible={showConfirmDeleteAll}
        title={t("title_confirmation_delete_all_sources")}
        onClose={() => setShowConfirmDeleteAll(false)}
        buttonsIsDisabled={isRemoving}
      />

      <p>{t("download_sources_description")}</p>

      <SettingsDownloadSourcesAutoOptions
        userPreferences={userPreferences}
        updateUserPreferences={updateUserPreferences}
      />

      <div className="settings-download-sources__header">
        <div className="settings-download-sources__buttons-container">
          <Button
            theme="outline"
            onClick={handleSync}
            disabled={isSyncing || downloadSources.length === 0}
          >
            <SyncIcon size={16} />
            {t("sync_download_sources", { defaultValue: "Sincronizar" })}
          </Button>

          <Button theme="primary" onClick={() => setShowAddModal(true)}>
            <PlusCircleIcon size={16} />
            {t("add_download_source", { defaultValue: "Adicionar fonte" })}
          </Button>

          <Button
            type="button"
            theme="danger"
            onClick={() => setShowConfirmDeleteAll(true)}
            disabled={isRemoving || isSyncing || !downloadSources.length}
          >
            <TrashIcon />
            {t("button_delete_all_sources")}
          </Button>
        </div>
      </div>

      {isPriorityEnabled ? (
        <Reorder.Group
          axis="y"
          values={displaySources}
          onReorder={handleReorder}
          className="settings-download-sources__list"
          as="ul"
        >
          {displaySources.map((source, index) => (
            <Reorder.Item
              key={source.id}
              value={source}
              as="li"
              style={{ listStyle: "none" }}
            >
              <DownloadSourceCard
                source={source}
                isSyncing={isSyncing}
                isRemoving={isRemoving}
                onRemove={handleRemoveSource}
                onNavigate={navigateToCatalogue}
                showPriority={isPriorityEnabled}
                priorityIndex={index}
                isFirst={index === 0}
                isLast={index === displaySources.length - 1}
                onMoveUp={() => handleMovePriority(index, "up")}
                onMoveDown={() => handleMovePriority(index, "down")}
              />
            </Reorder.Item>
          ))}
        </Reorder.Group>
      ) : (
        <ul className="settings-download-sources__list">
          {displaySources.map((source) => (
            <li key={source.id} style={{ listStyle: "none" }}>
              <DownloadSourceCard
                source={source}
                isSyncing={isSyncing}
                isRemoving={isRemoving}
                onRemove={handleRemoveSource}
                onNavigate={navigateToCatalogue}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
