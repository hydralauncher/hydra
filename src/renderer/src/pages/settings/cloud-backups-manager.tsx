import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  DownloadIcon,
  HistoryIcon,
  KebabHorizontalIcon,
  SearchIcon,
  SyncIcon,
  TrashIcon,
} from "@primer/octicons-react";
import { formatBytes } from "@shared";
import {
  Button,
  ConfirmationModal,
  SelectField,
  TextField,
} from "@renderer/components";
import { DropdownMenu } from "@renderer/components/dropdown-menu/dropdown-menu";
import { useToast } from "@renderer/hooks";
import type { CloudBackupEntry, CloudStorageUsage } from "@types";
import "./cloud-backups-manager.scss";

type SortKey = "date" | "name" | "size";

const formatDate = (iso: string | null | undefined): string => {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
};

interface Props {
  /** Whether the Yandex Disk account is currently connected. */
  connected: boolean;
}

export function CloudBackupsManager({ connected }: Readonly<Props>) {
  const { t } = useTranslation("settings");
  const { showSuccessToast, showErrorToast } = useToast();

  const [backups, setBackups] = useState<CloudBackupEntry[]>([]);
  const [usage, setUsage] = useState<CloudStorageUsage | null>(null);
  const [loadState, setLoadState] = useState<
    "idle" | "loading" | "error" | "loaded"
  >("idle");
  const [refreshing, setRefreshing] = useState(false);

  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("date");

  const [downloadingPath, setDownloadingPath] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [restoringPath, setRestoringPath] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CloudBackupEntry | null>(
    null
  );
  const [isDeleting, setIsDeleting] = useState(false);

  const load = useCallback(async () => {
    if (!connected) {
      setBackups([]);
      setUsage(null);
      setLoadState("idle");
      return;
    }

    setLoadState((prev) => (prev === "loaded" ? prev : "loading"));
    setRefreshing(true);

    try {
      const [backupsResult, usageResult] = await Promise.all([
        window.electron.listCloudBackups(),
        window.electron.getCloudStorageUsage(),
      ]);

      setBackups(backupsResult);
      setUsage(usageResult);
      setLoadState("loaded");
    } catch {
      setLoadState("error");
    } finally {
      setRefreshing(false);
    }
  }, [connected]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const removeProgressListener =
      window.electron.onCloudBackupDownloadProgress(({ path, percent }) => {
        setDownloadingPath(path);
        setDownloadProgress(percent);
      });

    const removeCompleteListener =
      window.electron.onCloudBackupDownloadComplete(
        ({ success, localPath }) => {
          setDownloadingPath(null);
          setDownloadProgress(0);

          if (success) {
            showSuccessToast(
              t("cloud_storage_download_complete", "Загрузка завершена"),
              localPath
            );
          } else {
            showErrorToast(
              t("cloud_storage_download_error", "Ошибка загрузки")
            );
          }
        }
      );

    return () => {
      removeProgressListener();
      removeCompleteListener();
    };
  }, [showSuccessToast, showErrorToast, t]);

  const visibleBackups = useMemo(() => {
    const filtered = search.trim()
      ? backups.filter((backup) =>
          backup.gameTitle.toLowerCase().includes(search.trim().toLowerCase())
        )
      : backups;

    const sorted = [...filtered];

    if (sortKey === "name") {
      sorted.sort((a, b) => a.gameTitle.localeCompare(b.gameTitle));
    } else if (sortKey === "size") {
      sorted.sort((a, b) => b.size - a.size);
    } else {
      sorted.sort((a, b) => b.modified.localeCompare(a.modified));
    }

    return sorted;
  }, [backups, search, sortKey]);

  const handleDownload = async (backup: CloudBackupEntry) => {
    const { filePaths, canceled } = await window.electron.showOpenDialog({
      properties: ["openDirectory"],
    });

    const destDir = filePaths?.[0];
    if (canceled || !destDir) return;

    setDownloadingPath(backup.path);
    setDownloadProgress(0);

    try {
      await window.electron.downloadCloudBackup(backup.path, destDir);
    } catch {
      setDownloadingPath(null);
      showErrorToast(t("cloud_storage_download_error", "Ошибка загрузки"));
    }
  };

  const handleRestore = async (backup: CloudBackupEntry) => {
    setRestoringPath(backup.path);
    try {
      await window.electron.restoreYandexDiskBackup(
        backup.objectId,
        backup.shop,
        backup.path
      );
      showSuccessToast(
        t("cloud_storage_restore_success", "Резервная копия восстановлена")
      );
    } catch {
      showErrorToast(t("cloud_storage_restore_error", "Ошибка восстановления"));
    } finally {
      setRestoringPath(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;

    setIsDeleting(true);
    try {
      await window.electron.deleteCloudBackup(deleteTarget.path);
      showSuccessToast(
        t("cloud_storage_delete_success", "Резервная копия удалена")
      );
      setDeleteTarget(null);
      await load();
    } catch {
      showErrorToast(t("cloud_storage_delete_error", "Ошибка удаления"));
    } finally {
      setIsDeleting(false);
    }
  };

  if (!connected) {
    return null;
  }

  return (
    <div className="cloud-backups-manager">
      {usage && (
        <div className="cloud-backups-manager__usage">
          <span>
            {t("cloud_storage_usage_backups_count", "Резервных копий")}:{" "}
            {usage.backupsCount}
          </span>
          <span>
            {t("cloud_storage_usage_backups_size", "Общий объём")}:{" "}
            {formatBytes(usage.backupsSize)}
          </span>
          {usage.totalSpace > 0 && (
            <span>
              {t("cloud_storage_usage_disk", "Диск")}:{" "}
              {formatBytes(usage.usedSpace)} / {formatBytes(usage.totalSpace)}
            </span>
          )}
        </div>
      )}

      <div className="cloud-backups-manager__toolbar">
        <TextField
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t(
            "cloud_storage_search_placeholder",
            "Поиск по названию игры"
          )}
          rightContent={<SearchIcon size={14} />}
        />

        <SelectField
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SortKey)}
          options={[
            {
              key: "date",
              value: "date",
              label: t("cloud_storage_sort_date", "По дате"),
            },
            {
              key: "name",
              value: "name",
              label: t("cloud_storage_sort_name", "По названию"),
            },
            {
              key: "size",
              value: "size",
              label: t("cloud_storage_sort_size", "По размеру"),
            },
          ]}
        />

        <Button theme="outline" onClick={load} disabled={refreshing}>
          <SyncIcon
            size={13}
            className={
              refreshing ? "cloud-backups-manager__refresh-icon--spinning" : ""
            }
          />
          <span>{t("cloud_storage_refresh", "Обновить")}</span>
        </Button>
      </div>

      {loadState === "loading" && (
        <p className="cloud-backups-manager__state-message">
          {t("cloud_storage_loading", "Загрузка списка резервных копий...")}
        </p>
      )}

      {loadState === "error" && (
        <p className="cloud-backups-manager__state-message cloud-backups-manager__state-message--error">
          {t(
            "cloud_storage_load_error",
            "Не удалось получить список резервных копий"
          )}
        </p>
      )}

      {loadState === "loaded" && visibleBackups.length === 0 && (
        <p className="cloud-backups-manager__state-message">
          {t("cloud_storage_empty", "Резервных копий пока нет")}
        </p>
      )}

      {visibleBackups.length > 0 && (
        <div className="cloud-backups-manager__list">
          {visibleBackups.map((backup) => (
            <div key={backup.path} className="cloud-backups-manager__item">
              <div className="cloud-backups-manager__item-main">
                <span className="cloud-backups-manager__item-title">
                  {backup.gameTitle}
                </span>
                <span className="cloud-backups-manager__item-meta">
                  {formatDate(backup.modified)} · {formatBytes(backup.size)}
                  {backup.metadata?.steamAppId &&
                    ` · AppID ${backup.metadata.steamAppId}`}
                  {backup.metadata?.gameVersion &&
                    ` · v${backup.metadata.gameVersion}`}
                  {backup.metadata?.platform &&
                    ` · ${backup.metadata.platform}`}
                </span>

                {downloadingPath === backup.path && (
                  <span className="cloud-backups-manager__item-progress">
                    {t("cloud_storage_downloading", "Загрузка")}:{" "}
                    {downloadProgress}%
                  </span>
                )}
              </div>

              <DropdownMenu
                align="end"
                items={[
                  {
                    icon: <DownloadIcon size={16} />,
                    label: t("cloud_storage_download", "Скачать"),
                    onClick: () => handleDownload(backup),
                    disabled: downloadingPath === backup.path,
                  },
                  {
                    icon: <HistoryIcon size={16} />,
                    label: t("cloud_storage_restore", "Восстановить"),
                    onClick: () => handleRestore(backup),
                    disabled: restoringPath === backup.path,
                  },
                  {
                    icon: <TrashIcon size={16} />,
                    label: t("cloud_storage_delete", "Удалить"),
                    onClick: () => setDeleteTarget(backup),
                  },
                ]}
              >
                <button
                  type="button"
                  className="cloud-backups-manager__item-menu"
                  aria-label={backup.gameTitle}
                >
                  <KebabHorizontalIcon size={16} />
                </button>
              </DropdownMenu>
            </div>
          ))}
        </div>
      )}

      <ConfirmationModal
        visible={deleteTarget !== null}
        title={t("cloud_storage_delete_title", "Удалить резервную копию?")}
        descriptionText={t("cloud_storage_delete_description", {
          name: deleteTarget?.gameTitle ?? "",
          defaultValue:
            "Резервная копия «{{name}}» будет удалена без возможности восстановления.",
        })}
        confirmButtonLabel={t("cloud_storage_delete", "Удалить")}
        cancelButtonLabel={t("cancel_remove", "Отмена")}
        buttonsIsDisabled={isDeleting}
        onConfirm={handleDelete}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}
