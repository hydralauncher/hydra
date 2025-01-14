import { useContext, useEffect, useState } from "react";

import {
  TextField,
  Button,
  Badge,
  ConfirmationModal,
} from "@renderer/components";
import { useTranslation } from "react-i18next";

import * as styles from "./settings-download-sources.css";
import type { DownloadSource } from "@types";
import {
  NoEntryIcon,
  PlusCircleIcon,
  SyncIcon,
  XIcon,
} from "@primer/octicons-react";
import { AddDownloadSourceModal } from "./add-download-source-modal";
import { useAppDispatch, useRepacks, useToast } from "@renderer/hooks";
import { DownloadSourceStatus } from "@shared";
import { settingsContext } from "@renderer/context";
import { downloadSourcesTable } from "@renderer/dexie";
import { downloadSourcesWorker } from "@renderer/workers";
import { useNavigate } from "react-router-dom";
import { setFilters, clearFilters } from "@renderer/features";

export function SettingsDownloadSources() {
  const [
    showConfirmationDeleteAllSourcesModal,
    setShowConfirmationDeleteAllSourcesModal,
  ] = useState(false);
  const [showAddDownloadSourceModal, setShowAddDownloadSourceModal] =
    useState(false);
  const [downloadSources, setDownloadSources] = useState<DownloadSource[]>([]);
  const [isSyncingDownloadSources, setIsSyncingDownloadSources] =
    useState(false);
  const [isRemovingDownloadSource, setIsRemovingDownloadSource] =
    useState(false);
  const [isFetchingSources, setIsFetchingSources] = useState(true);

  const { sourceUrl, clearSourceUrl } = useContext(settingsContext);

  const { t } = useTranslation("settings");
  const { showSuccessToast } = useToast();

  const dispatch = useAppDispatch();

  const navigate = useNavigate();

  const { updateRepacks } = useRepacks();

  const getDownloadSources = async () => {
    await downloadSourcesTable
      .toCollection()
      .sortBy("createdAt")
      .then((sources) => {
        setDownloadSources(sources.reverse());
      })
      .finally(() => {
        setIsFetchingSources(false);
      });
  };

  useEffect(() => {
    getDownloadSources();
  }, []);

  useEffect(() => {
    if (sourceUrl) setShowAddDownloadSourceModal(true);
  }, [sourceUrl]);

  const handleRemoveSource = (id: number) => {
    setIsRemovingDownloadSource(true);
    const channel = new BroadcastChannel(`download_sources:delete:${id}`);

    downloadSourcesWorker.postMessage(["DELETE_DOWNLOAD_SOURCE", id]);

    channel.onmessage = () => {
      showSuccessToast(t("removed_download_source"));

      getDownloadSources();
      setIsRemovingDownloadSource(false);
      channel.close();
      updateRepacks();
    };
  };

  const handleRemoveAllDowloadSources = () => {
    setIsRemovingDownloadSource(true);

    const id = crypto.randomUUID();
    const channel = new BroadcastChannel(`download_sources:delete_all:${id}`);

    downloadSourcesWorker.postMessage(["DELETE_ALL_DOWNLOAD_SOURCES", id]);

    channel.onmessage = () => {
      showSuccessToast(t("removed_download_sources"));

      getDownloadSources();
      setShowConfirmationDeleteAllSourcesModal(false);
      channel.close();
      updateRepacks();
    };
  };

  const handleAddDownloadSource = async () => {
    await getDownloadSources();
    showSuccessToast(t("added_download_source"));
    updateRepacks();
  };

  const syncDownloadSources = async () => {
    setIsSyncingDownloadSources(true);

    const id = crypto.randomUUID();
    const channel = new BroadcastChannel(`download_sources:sync:${id}`);

    downloadSourcesWorker.postMessage(["SYNC_DOWNLOAD_SOURCES", id]);

    channel.onmessage = () => {
      showSuccessToast(t("download_sources_synced"));
      getDownloadSources();
      setIsSyncingDownloadSources(false);
      channel.close();
      updateRepacks();
    };
  };

  const statusTitle = {
    [DownloadSourceStatus.UpToDate]: t("download_source_up_to_date"),
    [DownloadSourceStatus.Errored]: t("download_source_errored"),
  };

  const handleModalClose = () => {
    clearSourceUrl();
    setShowAddDownloadSourceModal(false);
  };

  const navigateToCatalogue = (fingerprint: string) => {
    dispatch(clearFilters());
    dispatch(setFilters({ downloadSourceFingerprints: [fingerprint] }));

    navigate("/catalogue");
  };

  return (
    <>
      <AddDownloadSourceModal
        visible={showAddDownloadSourceModal}
        onClose={handleModalClose}
        onAddDownloadSource={handleAddDownloadSource}
      />

      <ConfirmationModal
        cancelButtonLabel="Não"
        confirmButtonLabel="Sim, excluir"
        descriptionText="Você ira excluir todas as fontes de dowload"
        clickOutsideToClose={false}
        onConfirm={handleRemoveAllDowloadSources}
        visible={showConfirmationDeleteAllSourcesModal}
        title={"Excluir todas as fontes de dowload"}
        onClose={() => setShowConfirmationDeleteAllSourcesModal(false)}
        buttonsIsDisabled={isRemovingDownloadSource}
      />

      <p>{t("download_sources_description")}</p>

      <div className={styles.downloadSourcesHeader}>
        <Button
          type="button"
          theme="outline"
          disabled={
            !downloadSources.length ||
            isSyncingDownloadSources ||
            isRemovingDownloadSource
          }
          onClick={syncDownloadSources}
        >
          <SyncIcon />
          {t("sync_download_sources")}
        </Button>

        <Button
          type="button"
          theme="outline"
          onClick={() => setShowAddDownloadSourceModal(true)}
          disabled={isSyncingDownloadSources}
        >
          <PlusCircleIcon />
          {t("add_download_source")}
        </Button>
      </div>

      <ul className={styles.downloadSources}>
        {downloadSources.map((downloadSource) => (
          <li
            key={downloadSource.id}
            className={styles.downloadSourceItem({
              isSyncing: isSyncingDownloadSources,
            })}
          >
            <div className={styles.downloadSourceItemHeader}>
              <h2>{downloadSource.name}</h2>

              <div style={{ display: "flex" }}>
                <Badge>{statusTitle[downloadSource.status]}</Badge>
              </div>

              <button
                type="button"
                className={styles.navigateToCatalogueButton}
                disabled={!downloadSource.fingerprint}
                onClick={() => navigateToCatalogue(downloadSource.fingerprint)}
              >
                <small>
                  {t("download_count", {
                    count: downloadSource.downloadCount,
                    countFormatted:
                      downloadSource.downloadCount.toLocaleString(),
                  })}
                </small>
              </button>
            </div>

            <TextField
              label={t("download_source_url")}
              value={downloadSource.url}
              readOnly
              theme="dark"
              disabled
              rightContent={
                <Button
                  type="button"
                  theme="outline"
                  onClick={() => handleRemoveSource(downloadSource.id)}
                  disabled={isRemovingDownloadSource}
                >
                  <NoEntryIcon />
                  {t("remove_download_source")}
                </Button>
              }
            />
          </li>
        ))}
      </ul>

      {!isFetchingSources && downloadSources.length >= 2 && (
        <div className={styles.removeAllSourcesButton}>
          <Button
            type="button"
            theme="danger"
            onClick={() => setShowConfirmationDeleteAllSourcesModal(true)}
            disabled={isRemovingDownloadSource}
          >
            <XIcon />
            Remover todas as fontes de dowload
          </Button>
        </div>
      )}
    </>
  );
}
