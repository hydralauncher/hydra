import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button, Modal, TextField } from "@renderer/components";
import { useToast } from "@renderer/hooks";
import type {
  EmulationCloudSave,
  EmulationSavePlatform,
  MemcardRestoreTarget,
} from "@types";

import "./emulation-save-modals.scss";

export const PICK_FILTERS: Record<
  EmulationSavePlatform,
  { name: string; extensions: string[] }
> = {
  ps1: {
    name: "PS1 Memory Card",
    extensions: ["mcd", "mcr", "mc", "gme", "vgs", "vmp"],
  },
  ps2: { name: "PS2 Memory Card", extensions: ["ps2", "mcd", "mc2"] },
};

export const formatBytes = (bytes: number): string => {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1
  );
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(value >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
};

export const basename = (p: string): string => p.split(/[\\/]/).pop() ?? p;

export const formatDate = (iso: string | null): string => {
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

export function RestoreModal({
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
      <div className="emu-save-modal__restore">
        <ul className="emu-save-modal__targets">
          {targets.map((target) => (
            <li key={target.cardFilePath}>
              <button
                type="button"
                className={`emu-save-modal__target${
                  selected === target.cardFilePath
                    ? " emu-save-modal__target--selected"
                    : ""
                }`}
                onClick={() => setSelected(target.cardFilePath)}
              >
                <span className="emu-save-modal__target-name">
                  {target.cardLabel}
                </span>
                <span className="emu-save-modal__target-path">
                  {target.cardFilePath}
                </span>
              </button>
            </li>
          ))}
          {targets.length === 0 && (
            <li className="emu-save-modal__empty">
              {t("cloud_restore_no_cards")}
            </li>
          )}
        </ul>

        <div className="emu-save-modal__actions">
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

export function RenameModal({
  save,
  onClose,
  onRenamed,
}: Readonly<RenameModalProps>) {
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
      <div className="emu-save-modal__rename">
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
