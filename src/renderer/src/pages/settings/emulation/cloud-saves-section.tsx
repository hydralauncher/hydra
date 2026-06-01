import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ClockIcon,
  CodeIcon,
  DeviceDesktopIcon,
  HistoryIcon,
  PencilIcon,
  SyncIcon,
  TrashIcon,
} from "@primer/octicons-react";

import {
  Button,
  ConfirmationModal,
  Modal,
  TextField,
} from "@renderer/components";
import { useToast, useUserDetails } from "@renderer/hooks";
import type {
  EmulationCloudSave,
  EmulationSavePlatform,
  EmulatorConfig,
  MemcardRestoreTarget,
} from "@types";

import hydraSaveCard from "@renderer/assets/emulation/icons/hydra-save-card.png";

interface Props {
  config: EmulatorConfig;
  refreshKey: number;
}

const PICK_FILTERS: Record<
  EmulationSavePlatform,
  { name: string; extensions: string[] }
> = {
  ps1: {
    name: "PS1 Memory Card",
    extensions: ["mcd", "mcr", "mc", "gme", "vgs", "vmp"],
  },
  ps2: { name: "PS2 Memory Card", extensions: ["ps2", "mcd", "mc2"] },
};

const formatBytes = (bytes: number): string => {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1
  );
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(value >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
};

const basename = (p: string): string => p.split(/[\\/]/).pop() ?? p;

const formatDate = (iso: string | null): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
};

interface RestoreModalProps {
  save: EmulationCloudSave | null;
  platform: EmulationSavePlatform;
  onClose: () => void;
  onRestored: () => void;
}

function RestoreModal({
  save,
  platform,
  onClose,
  onRestored,
}: Readonly<RestoreModalProps>) {
  const { t } = useTranslation("settings");
  const { showSuccessToast, showErrorToast } = useToast();
  const [targets, setTargets] = useState<MemcardRestoreTarget[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!save) return;
    window.electron.getMemcardRestoreTargets(platform).then((found) => {
      setTargets(found);
      setSelected((prev) => prev ?? found[0]?.cardFilePath ?? null);
    });
  }, [save, platform]);

  const handlePickFile = useCallback(async () => {
    const result = await window.electron.showOpenDialog({
      properties: ["openFile"],
      filters: [PICK_FILTERS[platform]],
    });
    if (result.canceled || result.filePaths.length === 0) return;
    const chosen = result.filePaths[0];
    setTargets((prev) =>
      prev.some((tg) => tg.cardFilePath === chosen)
        ? prev
        : [...prev, { cardFilePath: chosen, cardLabel: basename(chosen) }]
    );
    setSelected(chosen);
  }, [platform]);

  const handleRestore = useCallback(async () => {
    if (!save || !selected) return;
    setBusy(true);
    try {
      const res = await window.electron.restoreEmulationSave(
        platform,
        save.id,
        selected
      );
      if (res.ok) {
        showSuccessToast(t("cloud_restore_success"));
        onRestored();
        onClose();
      } else {
        showErrorToast(t("cloud_restore_failed"));
      }
    } finally {
      setBusy(false);
    }
  }, [
    save,
    selected,
    platform,
    showSuccessToast,
    showErrorToast,
    t,
    onRestored,
    onClose,
  ]);

  return (
    <Modal
      visible={save !== null}
      title={t("cloud_restore_title")}
      description={t("cloud_restore_description")}
      onClose={onClose}
    >
      <div className="emulator-detail__restore-modal">
        <ul className="emulator-detail__restore-targets">
          {targets.map((target) => (
            <li key={target.cardFilePath}>
              <button
                type="button"
                className={`emulator-detail__restore-target${
                  selected === target.cardFilePath
                    ? " emulator-detail__restore-target--selected"
                    : ""
                }`}
                onClick={() => setSelected(target.cardFilePath)}
              >
                <span className="emulator-detail__restore-target-name">
                  {target.cardLabel}
                </span>
                <span className="emulator-detail__restore-target-path">
                  {target.cardFilePath}
                </span>
              </button>
            </li>
          ))}
          {targets.length === 0 && (
            <li className="emulator-detail__empty">
              {t("cloud_restore_no_cards")}
            </li>
          )}
        </ul>

        <div className="emulator-detail__restore-actions">
          <Button theme="outline" onClick={handlePickFile} disabled={busy}>
            {t("cloud_restore_pick_file")}
          </Button>
          <Button
            theme="primary"
            onClick={handleRestore}
            disabled={busy || !selected}
          >
            {busy ? t("cloud_restoring") : t("cloud_restore_confirm")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

interface RenameModalProps {
  save: EmulationCloudSave | null;
  onClose: () => void;
  onRenamed: () => void;
}

function RenameModal({ save, onClose, onRenamed }: Readonly<RenameModalProps>) {
  const { t } = useTranslation("settings");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setValue(save?.label ?? save?.fileName ?? "");
  }, [save]);

  const handleSave = useCallback(async () => {
    if (!save) return;
    setBusy(true);
    try {
      await window.electron.updateEmulationSaveLabel(save.id, value.trim());
      onRenamed();
      onClose();
    } finally {
      setBusy(false);
    }
  }, [save, value, onRenamed, onClose]);

  return (
    <Modal
      visible={save !== null}
      title={t("cloud_rename_title")}
      description={t("cloud_rename_description")}
      onClose={onClose}
    >
      <div className="emulator-detail__rename-modal">
        <TextField
          value={value}
          onChange={(e) => setValue(e.target.value)}
          label={t("cloud_rename_label")}
        />
        <Button
          theme="primary"
          onClick={handleSave}
          disabled={busy || value.trim().length === 0}
        >
          {t("cloud_rename_confirm")}
        </Button>
      </div>
    </Modal>
  );
}

export function CloudSavesSection({ config, refreshKey }: Readonly<Props>) {
  const { t } = useTranslation("settings");
  const { showSuccessToast } = useToast();
  const { hasActiveSubscription } = useUserDetails();
  const platform = config.system as EmulationSavePlatform;

  const [saves, setSaves] = useState<EmulationCloudSave[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [restoreFor, setRestoreFor] = useState<EmulationCloudSave | null>(null);
  const [renameFor, setRenameFor] = useState<EmulationCloudSave | null>(null);
  const [deleteFor, setDeleteFor] = useState<EmulationCloudSave | null>(null);

  const load = useCallback(async () => {
    if (!hasActiveSubscription) {
      setSaves([]);
      return;
    }
    setRefreshing(true);
    try {
      setSaves(await window.electron.listEmulationSaves(platform));
    } finally {
      setRefreshing(false);
    }
  }, [hasActiveSubscription, platform]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const handleDelete = useCallback(async () => {
    if (!deleteFor) return;
    await window.electron.deleteEmulationSave(deleteFor.id);
    setDeleteFor(null);
    showSuccessToast(t("cloud_delete_success"));
    load();
  }, [deleteFor, showSuccessToast, t, load]);

  // The section only exists once there are cloud saves to show.
  if (saves.length === 0) return null;

  return (
    <>
      <section className="emulator-detail__section emulator-detail__cloud-section">
        <header className="emulator-detail__section-header">
          <div className="emulator-detail__section-text">
            <h3>{t("cloud_saves_section_title")}</h3>
            <p>{t("cloud_saves_section_description")}</p>
          </div>
          <div className="emulator-detail__section-actions">
            <Button theme="outline" onClick={load} disabled={refreshing}>
              <SyncIcon
                size={13}
                className={
                  refreshing ? "emulator-detail__redetect-icon--spinning" : ""
                }
              />
              <span>{t("cloud_refresh")}</span>
            </Button>
          </div>
        </header>

        <div className="emulator-detail__cloud-grid">
          {saves.map((save) => (
            <div key={save.id} className="emulator-detail__cloud-card">
              <div className="emulator-detail__cloud-card-head">
                <img
                  className="emulator-detail__cloud-card-icon"
                  src={hydraSaveCard}
                  alt=""
                />
                <span
                  className="emulator-detail__cloud-card-title"
                  title={save.label ?? save.fileName}
                >
                  {save.label ?? save.fileName}
                </span>
                <button
                  type="button"
                  className="emulator-detail__cloud-icon-button"
                  onClick={() => setRenameFor(save)}
                  aria-label={t("cloud_rename_title")}
                >
                  <PencilIcon size={14} />
                </button>
                <span className="emulator-detail__cloud-card-size">
                  {formatBytes(save.artifactLengthInBytes)}
                </span>
              </div>

              <div className="emulator-detail__cloud-card-body">
                <div className="emulator-detail__cloud-card-info">
                  <span
                    className="emulator-detail__cloud-card-info-muted"
                    title={save.fileName}
                  >
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

                <div className="emulator-detail__cloud-card-actions">
                  <Button theme="outline" onClick={() => setRestoreFor(save)}>
                    <HistoryIcon size={14} />
                    <span>{t("cloud_restore")}</span>
                  </Button>
                  <button
                    type="button"
                    className="emulator-detail__cloud-delete"
                    onClick={() => setDeleteFor(save)}
                    aria-label={t("cloud_delete")}
                  >
                    <TrashIcon size={16} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

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
