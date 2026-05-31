import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  DownloadIcon,
  FileDirectoryIcon,
  QuestionIcon,
  SyncIcon,
  XIcon,
} from "@primer/octicons-react";

import { Button, ConfirmationModal } from "@renderer/components";
import { useToast } from "@renderer/hooks";
import type {
  EmulatorConfig,
  Ps2MemcardScanInput,
  Ps2MemoryCardSaveRecord,
} from "@types";

import {
  MemoryCardScanModal,
  type MemcardScanSummary,
} from "./memory-card-scan-modal";

interface Props {
  config: EmulatorConfig;
}

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

const saveKey = (save: Ps2MemoryCardSaveRecord): string =>
  `${save.cardFilePath}::${save.folderName}`;

export function MemoryCardsSection({ config: _config }: Readonly<Props>) {
  const { t } = useTranslation("settings");
  const { showSuccessToast, showErrorToast } = useToast();

  const [saves, setSaves] = useState<Ps2MemoryCardSaveRecord[]>([]);
  const [scanInput, setScanInput] = useState<Ps2MemcardScanInput | null>(null);
  const [exportingKey, setExportingKey] = useState<string | null>(null);
  const [forgetTarget, setForgetTarget] =
    useState<Ps2MemoryCardSaveRecord | null>(null);

  const loadSaves = useCallback(async () => {
    const list = await window.electron.listPs2MemcardSaves();
    setSaves(list);
  }, []);

  useEffect(() => {
    loadSaves();
  }, [loadSaves]);

  const groups = useMemo(() => {
    const map = new Map<string, Ps2MemoryCardSaveRecord[]>();
    for (const save of saves) {
      const list = map.get(save.cardLabel) ?? [];
      list.push(save);
      map.set(save.cardLabel, list);
    }
    return Array.from(map.entries());
  }, [saves]);

  const handlePickFile = useCallback(async () => {
    const result = await window.electron.showOpenDialog({
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "PS2 Memory Card", extensions: ["ps2", "mcd", "mc2"] }],
    });
    if (result.canceled || result.filePaths.length === 0) return;
    setScanInput({ autoDetect: false, manualPaths: result.filePaths });
  }, []);

  const handleScanComplete = useCallback(
    (summary: MemcardScanSummary) => {
      setScanInput(null);
      loadSaves();
      showSuccessToast(
        t("memcard_scan_done_toast", {
          saves: summary.saveCount,
          matched: summary.matched,
        })
      );
    },
    [loadSaves, showSuccessToast, t]
  );

  const handleExport = useCallback(
    async (save: Ps2MemoryCardSaveRecord) => {
      setExportingKey(saveKey(save));
      try {
        const res = await window.electron.exportPs2Save(
          save.cardFilePath,
          save.folderName,
          save.sku ?? save.folderName
        );
        if (res.ok && res.location) {
          showSuccessToast(t("memcard_export_success", { path: res.location }));
        } else if (res.error && res.error !== "cancelled") {
          showErrorToast(t("memcard_export_failed"));
        }
      } finally {
        setExportingKey(null);
      }
    },
    [showSuccessToast, showErrorToast, t]
  );

  const handleForget = useCallback(async () => {
    if (!forgetTarget) return;
    await window.electron.forgetPs2MemcardSave(
      forgetTarget.cardFilePath,
      forgetTarget.folderName
    );
    setForgetTarget(null);
    loadSaves();
  }, [forgetTarget, loadSaves]);

  return (
    <>
      <section className="emulator-detail__section">
        <header className="emulator-detail__section-header">
          <div className="emulator-detail__section-text">
            <h3>{t("memory_cards_section_title")}</h3>
            <p>{t("memory_cards_section_description")}</p>
          </div>
          <div className="emulator-detail__section-actions">
            <Button theme="outline" onClick={handlePickFile}>
              <FileDirectoryIcon size={14} />
              <span>{t("pick_memory_card_file")}</span>
            </Button>
            <Button
              theme="outline"
              onClick={() => setScanInput({ autoDetect: true })}
            >
              <SyncIcon size={13} />
              <span>{t("scan_memory_cards")}</span>
            </Button>
          </div>
        </header>

        {saves.length === 0 ? (
          <p className="emulator-detail__empty">{t("no_memory_cards")}</p>
        ) : (
          <div className="emulator-detail__memcards">
            {groups.map(([cardLabel, records]) => (
              <div key={cardLabel} className="emulator-detail__memcard-group">
                <span className="emulator-detail__memcard-group-title">
                  {cardLabel}
                </span>
                <div className="emulator-detail__memcard-grid">
                  {records.map((save) => {
                    const cover = save.libraryImageUrl ?? save.iconUrl;
                    const exporting = exportingKey === saveKey(save);
                    const title = save.title ?? save.folderName;
                    return (
                      <div
                        key={saveKey(save)}
                        className="emulator-detail__memcard-card"
                      >
                        <div className="emulator-detail__memcard-cover">
                          {cover ? (
                            <img src={cover} alt={title} loading="lazy" />
                          ) : (
                            <div className="emulator-detail__memcard-cover-placeholder">
                              <QuestionIcon size={28} />
                            </div>
                          )}
                        </div>
                        <div className="emulator-detail__memcard-info">
                          <span
                            className="emulator-detail__memcard-title"
                            title={title}
                          >
                            {title}
                          </span>
                          <span className="emulator-detail__memcard-sub">
                            {save.sku ?? save.folderName}
                          </span>
                          <span className="emulator-detail__memcard-meta">
                            {`${formatBytes(save.sizeBytes)} · ${t(
                              save.fileCount === 1
                                ? "memcard_files_count_one"
                                : "memcard_files_count_other",
                              { count: save.fileCount }
                            )}`}
                          </span>
                        </div>
                        <div className="emulator-detail__memcard-actions">
                          <Button
                            theme="outline"
                            onClick={() => handleExport(save)}
                            disabled={exporting}
                          >
                            <DownloadIcon size={14} />
                            <span>
                              {exporting
                                ? t("memcard_exporting")
                                : t("memcard_export")}
                            </span>
                          </Button>
                          <button
                            type="button"
                            className="emulator-detail__remove"
                            onClick={() => setForgetTarget(save)}
                            aria-label={t("memcard_forget")}
                          >
                            <XIcon size={16} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {scanInput && (
        <MemoryCardScanModal
          visible={scanInput !== null}
          input={scanInput}
          onComplete={handleScanComplete}
          onCancel={() => setScanInput(null)}
        />
      )}

      <ConfirmationModal
        visible={forgetTarget !== null}
        title={t("forget_memcard_save_title")}
        descriptionText={t("forget_memcard_save_description", {
          name: forgetTarget?.title ?? forgetTarget?.folderName ?? "",
        })}
        confirmButtonLabel={t("memcard_forget")}
        cancelButtonLabel={t("cancel_remove")}
        onConfirm={handleForget}
        onClose={() => setForgetTarget(null)}
      />
    </>
  );
}
