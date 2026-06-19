import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  ClockIcon,
  CodeIcon,
  DeviceDesktopIcon,
  HistoryIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  SyncIcon,
  TrashIcon,
  UploadIcon,
} from "@primer/octicons-react";

import { Button, ConfirmationModal } from "@renderer/components";
import {
  getSkuRegion,
  getSkuRegionFlag,
  getSkuRegionFromSaveIdentity,
} from "@renderer/helpers";
import { useToast, useUserDetails } from "@renderer/hooks";
import type {
  EmulationCloudSave,
  EmulationSavePlatform,
  MemoryCardSaveRecord,
} from "@types";

import hydraSaveCard from "@renderer/assets/emulation/icons/hydra-save-card.png";

import {
  RenameModal,
  RestoreModal,
  formatBytes,
  formatDate,
} from "../../settings/emulation/emulation-save-modals";

import "./game-emulation-saves.scss";

interface GameEmulationSavesProps {
  platform: EmulationSavePlatform;
  objectId: string;
}

const recordKey = (record: MemoryCardSaveRecord): string =>
  `${record.cardFilePath}::${record.folderName}`;

export function GameEmulationSaves({
  platform,
  objectId,
}: Readonly<GameEmulationSavesProps>) {
  const { t } = useTranslation("settings");
  const { t: tHydraCloud } = useTranslation("hydra_cloud");
  const { showSuccessToast, showErrorToast } = useToast();
  const { hasActiveSubscription } = useUserDetails();
  const navigate = useNavigate();

  const [cloudSaves, setCloudSaves] = useState<EmulationCloudSave[]>([]);
  const [records, setRecords] = useState<MemoryCardSaveRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const [restoreFor, setRestoreFor] = useState<EmulationCloudSave | null>(null);
  const [renameFor, setRenameFor] = useState<EmulationCloudSave | null>(null);
  const [deleteFor, setDeleteFor] = useState<EmulationCloudSave | null>(null);

  const load = useCallback(async () => {
    if (!hasActiveSubscription) {
      setCloudSaves([]);
      setRecords([]);
      return;
    }
    setLoading(true);
    try {
      const localPromise =
        platform === "ps2"
          ? window.electron.listPs2MemcardSaves()
          : window.electron.listPs1MemcardSaves();
      const [cloud, local] = await Promise.all([
        window.electron.listEmulationSaves(platform, objectId),
        localPromise,
      ]);
      setCloudSaves(cloud.filter((save) => save.objectId === objectId));
      setRecords(local);
    } finally {
      setLoading(false);
    }
  }, [hasActiveSubscription, platform, objectId]);

  useEffect(() => {
    load();
  }, [load]);

  const hasAnyCards = useMemo(
    () => new Set(records.map((r) => r.cardFilePath)).size > 0,
    [records]
  );

  const localSaves = useMemo(
    () => records.filter((r) => r.objectId === objectId),
    [records, objectId]
  );

  const handleUpload = useCallback(
    async (record: MemoryCardSaveRecord) => {
      const key = recordKey(record);
      setUploadingKey(key);
      try {
        await window.electron.uploadEmulationSave(
          platform,
          record.cardFilePath,
          record.folderName
        );
        showSuccessToast(t("cloud_backup_success"));
        load();
      } catch (_err) {
        showErrorToast(t("cloud_backup_failed"));
      } finally {
        setUploadingKey(null);
      }
    },
    [platform, showSuccessToast, showErrorToast, t, load]
  );

  const handleDelete = useCallback(async () => {
    if (!deleteFor) return;
    await window.electron.deleteEmulationSave(deleteFor.id);
    setDeleteFor(null);
    showSuccessToast(t("cloud_delete_success"));
    load();
  }, [deleteFor, showSuccessToast, t, load]);

  if (!hasActiveSubscription) {
    return (
      <div className="game-emulation-saves__upgrade">
        <p>{tHydraCloud("hydra_cloud_feature_found")}</p>
        <Button onClick={() => window.electron.openCheckout()}>
          {tHydraCloud("learn_more")}
        </Button>
      </div>
    );
  }

  return (
    <>
      <div className="game-emulation-saves__header">
        <div className="game-emulation-saves__header-text">
          <h2>{t("cloud_saves_section_title")}</h2>
          <p>{t("cloud_saves_section_description")}</p>
        </div>
        {hasAnyCards && (
          <Button theme="outline" onClick={load} disabled={loading}>
            <SyncIcon
              size={13}
              className={loading ? "game-emulation-saves__sync-icon" : ""}
            />
            <span>{t("cloud_refresh")}</span>
          </Button>
        )}
      </div>

      {!hasAnyCards ? (
        <div className="game-emulation-saves__prompt">
          <img
            className="game-emulation-saves__prompt-icon"
            src={hydraSaveCard}
            alt=""
          />
          <h3>{t("game_no_memcards_title")}</h3>
          <p>{t("game_no_memcards_description")}</p>
          <Button
            theme="outline"
            onClick={() =>
              navigate(`/settings?tab=emulation&system=${platform}`)
            }
          >
            <PlusIcon size={14} />
            <span>{t("game_add_memory_card")}</span>
          </Button>
        </div>
      ) : localSaves.length === 0 && cloudSaves.length === 0 ? (
        <div className="game-emulation-saves__prompt">
          <span className="game-emulation-saves__prompt-octicon">
            <SearchIcon size={40} />
          </span>
          <h3>{t("game_no_saves_title")}</h3>
          <p>{t("game_no_saves_found")}</p>
        </div>
      ) : (
        <div className="game-emulation-saves__groups">
          {localSaves.length > 0 && (
            <section className="game-emulation-saves__group">
              <h3 className="game-emulation-saves__group-title">
                {t("game_local_saves_title")}
              </h3>
              <ul className="game-emulation-saves__list">
                {localSaves.map((record) => {
                  const key = recordKey(record);
                  const uploading = uploadingKey === key;
                  const region = record.sku ? getSkuRegion(record.sku) : null;
                  return (
                    <li key={key} className="game-emulation-saves__card">
                      <div className="game-emulation-saves__card-head">
                        <img
                          className="game-emulation-saves__card-icon"
                          src={hydraSaveCard}
                          alt=""
                        />
                        {region && (
                          <img
                            className="game-emulation-saves__card-flag"
                            src={getSkuRegionFlag(region)}
                            alt={region}
                            title={region}
                          />
                        )}
                        <span
                          className="game-emulation-saves__card-title"
                          title={record.title ?? record.folderName}
                        >
                          {record.title ?? record.folderName}
                        </span>
                        <small className="game-emulation-saves__card-size">
                          {formatBytes(record.sizeBytes)}
                        </small>
                      </div>

                      <div className="game-emulation-saves__card-body">
                        <div className="game-emulation-saves__card-meta">
                          <span title={record.cardLabel}>
                            <DeviceDesktopIcon size={14} />
                            {record.cardLabel}
                          </span>
                          <span>
                            <ClockIcon size={14} />
                            {formatDate(
                              record.modifiedAt
                                ? new Date(record.modifiedAt).toISOString()
                                : null
                            )}
                          </span>
                        </div>

                        <div className="game-emulation-saves__card-actions">
                          <Button
                            theme="outline"
                            onClick={() => handleUpload(record)}
                            disabled={uploading}
                          >
                            {uploading ? (
                              <SyncIcon
                                size={14}
                                className="game-emulation-saves__sync-icon"
                              />
                            ) : (
                              <UploadIcon size={14} />
                            )}
                            <span>
                              {uploading
                                ? t("cloud_backing_up")
                                : t("cloud_backup")}
                            </span>
                          </Button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {cloudSaves.length > 0 && (
            <section className="game-emulation-saves__group">
              <h3 className="game-emulation-saves__group-title">
                {t("game_cloud_group_title")}
              </h3>
              <ul className="game-emulation-saves__list">
                {cloudSaves.map((save) => {
                  const region = getSkuRegionFromSaveIdentity(
                    save.saveIdentity
                  );
                  return (
                    <li key={save.id} className="game-emulation-saves__card">
                      <div className="game-emulation-saves__card-head">
                        <img
                          className="game-emulation-saves__card-icon"
                          src={hydraSaveCard}
                          alt=""
                        />
                        {region && (
                          <img
                            className="game-emulation-saves__card-flag"
                            src={getSkuRegionFlag(region)}
                            alt={region}
                            title={region}
                          />
                        )}
                        <span
                          className="game-emulation-saves__card-title"
                          title={save.label ?? save.fileName}
                        >
                          {save.label ?? save.fileName}
                        </span>
                        <button
                          type="button"
                          className="game-emulation-saves__icon-button"
                          onClick={() => setRenameFor(save)}
                          aria-label={t("cloud_rename_title")}
                        >
                          <PencilIcon size={14} />
                        </button>
                        <small className="game-emulation-saves__card-size">
                          {formatBytes(save.artifactLengthInBytes)}
                        </small>
                      </div>

                      <div className="game-emulation-saves__card-body">
                        <div className="game-emulation-saves__card-meta">
                          <span title={save.fileName}>
                            <CodeIcon size={14} />
                            {save.fileName}
                          </span>
                          <span>
                            <DeviceDesktopIcon size={14} />
                            {save.hostname ?? "—"}
                          </span>
                          <span>
                            <ClockIcon size={14} />
                            {formatDate(save.localLastModifiedAt)}
                          </span>
                        </div>

                        <div className="game-emulation-saves__card-actions">
                          <Button
                            theme="outline"
                            onClick={() => setRestoreFor(save)}
                          >
                            <HistoryIcon size={14} />
                            <span>{t("cloud_restore")}</span>
                          </Button>
                          <button
                            type="button"
                            className="game-emulation-saves__delete"
                            onClick={() => setDeleteFor(save)}
                            aria-label={t("cloud_delete")}
                          >
                            <TrashIcon size={16} />
                          </button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </div>
      )}

      <RestoreModal
        save={restoreFor}
        platform={platform}
        onClose={() => setRestoreFor(null)}
        onRestored={load}
      />

      <RenameModal
        save={renameFor}
        onClose={() => setRenameFor(null)}
        onRenamed={load}
      />

      <ConfirmationModal
        visible={deleteFor !== null}
        title={t("cloud_delete_title")}
        descriptionText={t("cloud_delete_description", {
          name: deleteFor?.label ?? deleteFor?.fileName ?? "",
        })}
        confirmButtonLabel={t("cloud_delete")}
        cancelButtonLabel={t("cancel_remove")}
        onConfirm={handleDelete}
        onClose={() => setDeleteFor(null)}
      />
    </>
  );
}
